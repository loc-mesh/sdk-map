/**
 * Getting a credential onto every request the map library makes.
 *
 * 🔴 A MAP LIBRARY FETCHES ITS OWN TILES, AND YOU CANNOT GIVE THOSE REQUESTS A
 * HEADER. It reads a style document and then generates hundreds of requests for
 * squares, fonts and icons on its own. There is no interception point where an
 * `Authorization` header can be attached, which is why the credential travels
 * in the URL and why every consumer that wires this by hand writes the same
 * `transformRequest` hook.
 *
 * 🔴 AND A MAP TOKEN EXPIRES WHILE SOMEONE IS LOOKING AT THE MAP. Tokens are
 * short-lived by design — four hours by default. Nothing in a naive integration
 * refreshes them, so a driver's map goes blank part-way through a shift, with
 * no error anyone sees and no action that brings it back except reloading the
 * page. Handling that is not a nicety; it is most of the reason to use a
 * package instead of forty lines of your own.
 */

import { classify, type MeshMapError } from './errors.js';

export interface MintedToken {
  token: string;
  /** ISO 8601. Used to schedule the refresh; a missing value is treated as one hour. */
  expiresAt?: string;
}

export type TokenMinter = () => Promise<MintedToken>;

/** Refresh at 80% of the token's life — early enough to absorb a slow mint. */
const REFRESH_AT = 0.8;
/** Never schedule further out than this, so a wrong clock cannot park a refresh for a week. */
const MAX_DELAY_MS = 60 * 60 * 1000;
/** Nor sooner than this, so a bad `expiresAt` cannot spin. */
const MIN_DELAY_MS = 30 * 1000;

/**
 * Holds whichever credential the caller supplied and keeps it current.
 *
 * A map key never changes and needs none of this. A minted token does, and the
 * two are deliberately the same interface to the rest of the package so nothing
 * downstream has to care which it was given.
 */
export class Credential {
  private value: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  private constructor(
    value: string,
    private readonly minter: TokenMinter | undefined,
    private readonly onError: (e: MeshMapError) => void,
  ) {
    this.value = value;
  }

  static fromKey(key: string, onError: (e: MeshMapError) => void): Credential {
    return new Credential(key, undefined, onError);
  }

  static async fromMinter(
    minter: TokenMinter,
    onError: (e: MeshMapError) => void,
  ): Promise<Credential> {
    const first = await minter();
    const c = new Credential(first.token, minter, onError);
    c.schedule(first.expiresAt);
    return c;
  }

  /** The current credential. Read fresh on every request, never captured. */
  get current(): string {
    return this.value;
  }

  /** Stop refreshing. Call when the map is destroyed, or the timer outlives the page's need for it. */
  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(expiresAt: string | undefined): void {
    if (!this.minter || this.stopped) return;
    const expiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    const lifetime = Number.isFinite(expiry) ? expiry - Date.now() : 60 * 60 * 1000;
    const delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, lifetime * REFRESH_AT));

    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    if (this.stopped || !this.minter) return;
    try {
      const next = await this.minter();
      this.value = next.token;
      this.schedule(next.expiresAt);
    } catch (raw) {
      // ⚠️ Report, then try again rather than giving up. The current token is
      // usually still valid for a while — this is a warning that the map will
      // go dark later, which is a far more useful thing to say now than after.
      this.onError({
        ...classify(raw),
        code: 'token_refresh_failed',
        message:
          'Could not mint a new map token. The map keeps working until the current one expires, ' +
          'and then stops drawing.',
        fatal: false,
      });
      this.timer = setTimeout(() => void this.refresh(), MIN_DELAY_MS);
    }
  }
}

/**
 * The hook that puts the credential on every generated request.
 *
 * ⚠️ Only on requests to the tiles service. A `transformRequest` that appends a
 * credential to every URL the library touches would leak it to any third-party
 * source a caller adds later.
 */
export function transformRequest(origin: string, credential: () => string) {
  return (url: string): { url: string } => {
    if (!url.startsWith(origin)) return { url };
    const u = new URL(url);
    // The style document already carries the credential on everything it
    // references; only add one where it is genuinely absent, so a rotated token
    // in a freshly fetched style is not overwritten by a stale closure.
    if (!u.searchParams.has('key') && !u.searchParams.has('token')) {
      u.searchParams.set('key', credential());
    }
    return { url: u.toString() };
  };
}
