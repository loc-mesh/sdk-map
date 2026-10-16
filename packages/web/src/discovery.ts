/**
 * Finding out what this environment can actually serve.
 *
 * 🔴 WHY THIS IS NOT A CONSTANT. Every map address is
 * `/v1/<region>/<version>/…`, and both segments come from whatever the map
 * pipeline last published. They cannot be guessed, they differ per
 * environment, and they change when a new build lands.
 *
 * ⚠️ AND THE SERVICE'S CONTRACT DOES NOT DESCRIBE THE SHAPE OF THE ANSWER. The
 * OpenAPI document types `GET /api` as a bare `object`, while its prose insists
 * the fields in it are unguessable. An application built against Mesh on
 * 2026-10-16 responded to that, entirely reasonably, by shipping a forty-line
 * recursive crawler that walked four levels deep looking for any key matching
 * /region/i with five fallback field names. Doing that once, here, is the
 * difference between this package existing and not.
 */

import { classify, type MeshMapError } from './errors.js';

export interface Published {
  region: string;
  /** The explicit build version, never the word "current" — see `pin`. */
  version: string;
  /** Themes this service says it can paint, straight from the service. */
  themes: string[];
}

interface RegionRow {
  region?: unknown;
  currentVersion?: unknown;
}

/**
 * Ask the service what it has, and pin to it.
 *
 * 🔴 PINNING IS THE POINT, NOT AN OPTIMISATION. Asking for `current` on every
 * request means that when a new build publishes underneath a live page, the
 * style a browser already holds stops matching the squares it is still
 * fetching. Resolve `current` ONCE, keep the explicit version for the life of
 * the session, and the map a user is looking at stays internally consistent
 * however many builds land while they look at it.
 */
export async function discover(
  baseUrl: string,
  opts: { region?: string; fetchImpl?: typeof fetch } = {},
): Promise<Published> {
  const doFetch = opts.fetchImpl ?? fetch;
  let body: Record<string, unknown>;

  try {
    const res = await doFetch(`${baseUrl.replace(/\/$/, '')}/api`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw Object.assign(new Error(`the tiles service answered ${res.status}`), {
        status: res.status,
      });
    }
    body = (await res.json()) as Record<string, unknown>;
  } catch (raw) {
    const err: MeshMapError = {
      ...classify(raw),
      code: 'discovery_failed',
      message:
        `Could not ask ${baseUrl} what map data it has. Check the base URL — it should be the ` +
        `tiles service origin, with no path.`,
      fatal: true,
    };
    throw err;
  }

  const rows = Array.isArray(body.regions) ? (body.regions as RegionRow[]) : [];
  const wanted = opts.region
    ? rows.find((r) => String(r.region) === opts.region)
    : rows[0];

  if (!wanted || typeof wanted.region !== 'string' || typeof wanted.currentVersion !== 'string') {
    const available = rows.map((r) => String(r.region)).filter(Boolean);
    const err: MeshMapError = {
      code: 'no_map_data',
      message: opts.region
        ? `This environment does not serve the region "${opts.region}". It serves: ` +
          `${available.join(', ') || 'nothing yet'}.`
        : 'This environment has no published map data yet, so there is no region to draw.',
      fatal: true,
    };
    throw err;
  }

  // Themes are read rather than hard-coded: the service is the only thing that
  // knows which it can actually paint, and a list baked in here would be a
  // second source of truth that goes stale on their next release.
  const themes = (body.themes as { available?: unknown } | undefined)?.available;

  return {
    region: wanted.region,
    version: wanted.currentVersion,
    themes: Array.isArray(themes) ? themes.map(String) : [],
  };
}
