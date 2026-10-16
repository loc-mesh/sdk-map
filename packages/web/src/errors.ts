/**
 * Why the map is not drawing.
 *
 * 🔴 THE FAILURE THIS FILE EXISTS FOR. On 2026-10-16 an application built
 * against Mesh showed a blank grey rectangle and the status line
 * "Loaded from Mesh". Every tile request had returned **200**, with the right
 * content type and a plausible number of bytes, and the map library had refused
 * every one of them. The application's error handler surfaced only failures
 * carrying an HTTP status, and a tile that cannot be parsed has none.
 *
 * That is the shape of almost every map failure: the page does not crash, the
 * console stays quiet, and a grey rectangle is indistinguishable from an empty
 * ocean. So this control reports a cause, every time, with a code worth keying
 * on and a sentence worth showing a user.
 */

export type MeshMapErrorCode =
  /** The map key or token was refused. Usually wrong key, wrong environment, or an origin the key is not allowed on. */
  | 'credential_rejected'
  /** Authenticated, but the tenant does not have the Maps module enabled. */
  | 'module_not_enabled'
  /** The environment has no published map data at all, so no region can be served. */
  | 'no_map_data'
  /** The service could not be asked what it can serve. Usually a wrong base URL or a network failure. */
  | 'discovery_failed'
  /** A square arrived and could not be read. Answers 200; draws nothing. */
  | 'tile_unreadable'
  /** The tenant is over its allowance for this period. */
  | 'quota_exceeded'
  /** Minting a short-lived map token failed, so the map cannot keep refreshing. */
  | 'token_refresh_failed'
  /** Anything else, with the original attached. */
  | 'unknown';

export interface MeshMapError {
  code: MeshMapErrorCode;
  /** One sentence, written to be shown to a developer, not parsed. */
  message: string;
  /** HTTP status where there was one. A parse failure has none — that is the point. */
  status?: number;
  /** The request that failed, with any credential removed. */
  url?: string;
  /** Whether the map is still usable. A single bad square is not an outage. */
  fatal: boolean;
  cause?: unknown;
}

/** Never put a credential in an error, a log line or an event. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    for (const p of ['key', 'token', 'access_token']) if (u.searchParams.has(p)) u.searchParams.set(p, '…');
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Turn whatever the map library threw into something with a cause.
 *
 * ⚠️ The ordering matters. A tile parse failure carries no status, so checking
 * status first and giving up classifies the most confusing failure mode as
 * "unknown" — which is where this started.
 */
export function classify(raw: unknown): MeshMapError {
  const err = raw as { message?: string; status?: number; url?: string } | undefined;
  const message = String(err?.message ?? raw ?? 'the map failed for a reason it did not state');
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const url = err?.url ? redact(err.url) : undefined;

  if (/unable to parse the tile|unimplemented type|not a gzip|invalid/i.test(message) && !status) {
    return {
      code: 'tile_unreadable',
      message:
        'A map square arrived but could not be read, so nothing from it is drawn. The request ' +
        'succeeded — this is a problem with the bytes, not the connection.',
      url,
      fatal: false,
      cause: raw,
    };
  }

  if (status === 401 || status === 403) {
    // 403 with a module code is a different fix from a bad key: one is a
    // support conversation about entitlement, the other is a typo.
    const moduleGated = /module/i.test(message);
    return {
      code: moduleGated ? 'module_not_enabled' : 'credential_rejected',
      message: moduleGated
        ? 'The credential is valid but this tenant does not have the Maps module enabled.'
        : 'The map key or token was refused. Check the key, the environment it belongs to, and ' +
          'whether this page\'s origin is one the key allows.',
      status,
      url,
      fatal: true,
      cause: raw,
    };
  }

  if (status === 429) {
    return {
      code: 'quota_exceeded',
      message: 'This tenant is over its map allowance for the current period.',
      status,
      url,
      fatal: false,
      cause: raw,
    };
  }

  if (status === 503) {
    return {
      code: 'no_map_data',
      message:
        'The service is reachable but has no map data published for this environment, so there ' +
        'is nothing to draw.',
      status,
      url,
      fatal: true,
      cause: raw,
    };
  }

  return { code: 'unknown', message, status, url, fatal: false, cause: raw };
}
