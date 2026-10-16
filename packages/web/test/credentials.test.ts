import { describe, expect, it, vi } from 'vitest';
import { Credential, transformRequest } from '../src/credentials';

const ORIGIN = 'https://tiles-api.test-mesh.locate2u.app';

describe('transformRequest', () => {
  const hook = transformRequest(ORIGIN, () => 'CRED');

  it('adds the credential to requests the map library generates', () => {
    expect(hook(`${ORIGIN}/v1/a/v/tiles/1/2/3.mvt`).url).toContain('key=CRED');
  });

  // ⚠️ A hook that appended the credential to everything would leak it to any
  // third-party source a caller adds to the map later.
  it('never puts the credential on anything that is not ours', () => {
    const other = 'https://example.com/anything.json';
    expect(hook(other).url).toBe(other);
  });

  // The style document already carries a credential on everything it
  // references. Overwriting it would replace a freshly rotated token with a
  // stale one captured in a closure.
  it('leaves a credential that is already there alone', () => {
    expect(hook(`${ORIGIN}/t.mvt?key=ALREADY`).url).toContain('key=ALREADY');
    expect(hook(`${ORIGIN}/t.mvt?token=ALREADY`).url).not.toContain('CRED');
  });
});

describe('Credential', () => {
  it('holds a map key unchanged and schedules nothing', () => {
    const c = Credential.fromKey('mk_test_1', () => {});
    expect(c.current).toBe('mk_test_1');
    c.dispose();
  });

  /**
   * 🔴 A TOKEN EXPIRES WHILE SOMEONE IS LOOKING AT THE MAP. Four hours is the
   * default, so a naive integration goes blank part-way through a shift with no
   * error anyone sees and no recovery but a page reload.
   */
  it('refreshes a minted token before it expires', async () => {
    vi.useFakeTimers();
    try {
      let issued = 0;
      const mint = vi.fn(async () => ({
        token: `mt_${++issued}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }));
      const c = await Credential.fromMinter(mint, () => {});
      expect(c.current).toBe('mt_1');

      // 80% of a 60-second life, plus a tick for the mint to resolve.
      await vi.advanceTimersByTimeAsync(49_000);
      expect(c.current).toBe('mt_2');
      c.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed refresh as a warning and keeps trying', async () => {
    vi.useFakeTimers();
    try {
      const codes: string[] = [];
      let calls = 0;
      const mint = vi.fn(async () => {
        calls++;
        if (calls === 2) throw new Error('backend down');
        return { token: `mt_${calls}`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
      });
      const c = await Credential.fromMinter(mint, (e) => codes.push(e.code));
      await vi.advanceTimersByTimeAsync(49_000);
      expect(codes).toContain('token_refresh_failed');

      // ⚠️ Not fatal and not given up on. The current token is usually still
      // good, so this is early warning that the map WILL go dark, not a report
      // that it already has.
      await vi.advanceTimersByTimeAsync(31_000);
      expect(c.current).toBe('mt_3');
      c.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops refreshing once disposed, so a removed map cannot keep minting', async () => {
    vi.useFakeTimers();
    try {
      const mint = vi.fn(async () => ({
        token: 'mt_1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }));
      const c = await Credential.fromMinter(mint, () => {});
      c.dispose();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(mint).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
