import { describe, expect, it, vi } from 'vitest';
import { discover } from '../src/discovery';

const ok = (body: unknown) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

const API = {
  regions: [{ region: 'australia', currentVersion: '20261015-2ec3f733' }],
  themes: { available: ['light', 'dark', 'white', 'grayscale', 'black'] },
};

describe('discover', () => {
  it('reads the two path segments nothing else publishes', async () => {
    const p = await discover('https://tiles-api.test-mesh.locate2u.app', { fetchImpl: ok(API) });
    expect(p.region).toBe('australia');
    expect(p.version).toBe('20261015-2ec3f733');
  });

  // 🔴 Pinning is the point. Keeping "current" means a build publishing under a
  // live page leaves the browser holding a style that no longer matches the
  // squares it is still fetching.
  it('resolves to an explicit build, never the word "current"', async () => {
    const p = await discover('https://x', { fetchImpl: ok(API) });
    expect(p.version).not.toBe('current');
  });

  it('reads the theme list from the service rather than hard-coding one', async () => {
    const p = await discover('https://x', { fetchImpl: ok(API) });
    expect(p.themes).toContain('dark');
  });

  it('tolerates a service that reports no themes at all', async () => {
    const p = await discover('https://x', { fetchImpl: ok({ regions: API.regions }) });
    expect(p.themes).toEqual([]);
  });

  it('can be pinned to a named region, and says what exists when that name is wrong', async () => {
    const two = { regions: [...API.regions, { region: 'newzealand', currentVersion: 'v2' }] };
    const nz = await discover('https://x', { region: 'newzealand', fetchImpl: ok(two) });
    expect(nz.version).toBe('v2');
    await expect(
      discover('https://x', { region: 'narnia', fetchImpl: ok(two) }),
    ).rejects.toMatchObject({ code: 'no_map_data', message: expect.stringContaining('australia') });
  });

  it('says the environment is empty rather than drawing nothing silently', async () => {
    await expect(discover('https://x', { fetchImpl: ok({ regions: [] }) })).rejects.toMatchObject({
      code: 'no_map_data',
      fatal: true,
    });
  });

  // ⚠️ The most common setup mistake is a base URL with a path on it, so the
  // message names the thing to go and look at.
  it('blames the base URL when the service cannot be asked', async () => {
    const dead = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    await expect(discover('https://wrong.example', { fetchImpl: dead })).rejects.toMatchObject({
      code: 'discovery_failed',
      message: expect.stringContaining('base URL'),
    });
  });
});
