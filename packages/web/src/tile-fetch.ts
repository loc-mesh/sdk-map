/**
 * Map squares from the tiles service are fetched here rather than by the map
 * library, so they can be held while the service is saying 429 — see
 * `pause.ts`.
 *
 * The map library lets a page register its own URL scheme. `rewrite` moves
 * every square bound for the tiles service onto that scheme; `fetchTile`
 * waits at the gate, fetches over the real scheme, and tells the gate what
 * came back. Nothing else the library loads is touched.
 */

import { addProtocol } from 'maplibre-gl';
import { gate as defaultGate, type RequestGate } from './pause.js';

const PREFIX = 'meshtile+';
let registered = false;

/** Register the scheme with the map library, once per page. */
export function registerTileProtocol(): void {
  if (registered) return;
  registered = true;
  const load = (params: { url: string; headers?: Record<string, string> }, abort: AbortController) =>
    fetchTile(params.url, abort.signal, params.headers);
  addProtocol('meshtile+https', load);
  addProtocol('meshtile+http', load);
}

/** Move a square bound for the tiles service onto the gated scheme. */
export function rewrite(url: string): string {
  return url.startsWith('http') ? PREFIX + url : url;
}

export async function fetchTile(
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>,
  deps: { gate?: RequestGate; fetch?: typeof fetch } = {},
): Promise<{ data: ArrayBuffer; cacheControl?: string; expires?: string }> {
  const g = deps.gate ?? defaultGate;
  const doFetch = deps.fetch ?? fetch;
  const real = url.startsWith(PREFIX) ? url.slice(PREFIX.length) : url;

  await g.wait(signal);

  let res: Response;
  try {
    res = await doFetch(real, { signal, headers });
  } catch (e) {
    g.abandoned();
    throw e;
  }

  if (res.status === 429) {
    g.limited();
    throw await httpError(res, real);
  }
  g.succeeded();
  if (!res.ok) throw await httpError(res, real);

  return {
    data: await res.arrayBuffer(),
    cacheControl: res.headers.get('cache-control') ?? undefined,
    expires: res.headers.get('expires') ?? undefined,
  };
}

/**
 * Shaped like the map library's own HTTP error, so `classify` reads it the
 * same way. The service's error code goes into the message, because it is the
 * only thing that separates the per-minute limit from the monthly allowance.
 */
async function httpError(res: Response, url: string): Promise<Error> {
  let code = '';
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    code = body?.error?.code ?? '';
  } catch {
    // An unreadable body is not worth a second failure.
  }
  const e = new Error(`${res.status} ${res.statusText}${code ? ` (${code})` : ''}`) as Error & {
    status: number;
    url: string;
  };
  e.name = 'AJAXError';
  e.status = res.status;
  e.url = url;
  return e;
}
