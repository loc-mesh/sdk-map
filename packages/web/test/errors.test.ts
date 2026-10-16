import { describe, expect, it } from 'vitest';
import { classify, redact } from '../src/errors';

/**
 * 🔴 THE BUG THIS PACKAGE WAS BUILT AROUND.
 *
 * On 2026-10-16 an application built against Mesh displayed a blank grey
 * rectangle and the status line "Loaded from Mesh". Every tile request had
 * answered **200** with a plausible body, and the map library had refused all
 * of them. The application's handler surfaced only errors carrying an HTTP
 * status, and a tile that cannot be parsed has none — so the most confusing
 * failure the platform can produce was the one failure it could not report.
 */
describe('classify', () => {
  it('recognises an unreadable tile, which carries no status at all', () => {
    const e = classify({
      message:
        'Unable to parse the tile at https://tiles-api.test-mesh.locate2u.app/v1/australia/' +
        '20261015/tiles/14/15156/9495.mvt?key=mk_test_secret, please make sure the data is not gzipped',
    });
    expect(e.code).toBe('tile_unreadable');
    // ⚠️ Not fatal. One bad square is not an outage, and reporting it as one
    // would be its own kind of wrong.
    expect(e.fatal).toBe(false);
    expect(e.message).toContain('could not be read');
  });

  it('never repeats a credential back into an error', () => {
    const e = classify({
      message: 'Unable to parse the tile at https://x/t.mvt?key=mk_test_secret',
      url: 'https://x/t.mvt?key=mk_test_secret',
    });
    expect(e.url).not.toContain('mk_test_secret');
    expect(e.url).toContain('key=');
  });

  // ⚠️ 403 means two different things and they have different fixes: one is a
  // typo, the other is a conversation about entitlement.
  it('separates a refused credential from a module that is not enabled', () => {
    expect(classify({ status: 403, message: 'forbidden' }).code).toBe('credential_rejected');
    expect(classify({ status: 403, message: 'module_not_enabled' }).code).toBe('module_not_enabled');
    expect(classify({ status: 401, message: 'unauthorized' }).code).toBe('credential_rejected');
  });

  it('knows an environment with no map published from one that is over quota', () => {
    expect(classify({ status: 503, message: 'no data' }).code).toBe('no_map_data');
    expect(classify({ status: 503, message: 'no data' }).fatal).toBe(true);
    expect(classify({ status: 429, message: 'slow down' }).code).toBe('quota_exceeded');
    expect(classify({ status: 429, message: 'slow down' }).fatal).toBe(false);
  });

  it('still answers for something it has never seen, rather than throwing', () => {
    const e = classify(undefined);
    expect(e.code).toBe('unknown');
    expect(e.message.length).toBeGreaterThan(0);
  });
});

describe('redact', () => {
  it('removes every credential-shaped parameter', () => {
    const out = redact(
      'https://x/a?key=SECRETKEY&token=SECRETTOKEN&access_token=SECRETACCESS&zoom=11',
    );
    for (const secret of ['SECRETKEY', 'SECRETTOKEN', 'SECRETACCESS']) {
      expect(out, `${secret} survived redaction`).not.toContain(secret);
    }
    // The parameter names stay, so a reader can still see what was presented.
    expect(out).toContain('key=');
    expect(out).toContain('zoom=11');
  });

  it('returns something unbroken when handed a string that is not a URL', () => {
    expect(redact('not a url')).toBe('not a url');
  });
});
