import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestGate } from '../src/pause.js';
import { fetchTile } from '../src/tile-fetch.js';

const res = (status: number, body = '') =>
  new Response(status === 204 ? null : body, { status, statusText: String(status) });

describe('pausing on 429', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends nothing for ten seconds after a 429, however much is asked for', async () => {
    const gate = new RequestGate(10_000);
    const fetch = vi.fn(async () => res(429, '{"error":{"code":"rate_limited"}}'));
    await expect(fetchTile('meshtile+https://t/1', new AbortController().signal, undefined, { gate, fetch })).rejects.toThrow('429');
    expect(gate.current).toBe('paused');

    // The person keeps dragging: five more squares, none reach the network.
    const held = Array.from({ length: 5 }, (_, i) =>
      fetchTile(`meshtile+https://t/${i + 2}`, new AbortController().signal, undefined, { gate, fetch }).catch(() => 'x'),
    );
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Ten seconds up: exactly ONE probe goes, is refused, and the gate closes again.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(gate.current).toBe('paused');

    // Next window: the service has recovered, the probe succeeds, everything waiting goes.
    fetch.mockImplementation(async () => res(200, 'tile'));
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(held);
    expect(gate.current).toBe('open');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('never sends a square that was dragged past while paused', async () => {
    const gate = new RequestGate(10_000);
    gate.limited();
    const fetch = vi.fn(async () => res(200, 'tile'));
    const abort = new AbortController();
    const p = fetchTile('meshtile+https://t/a', abort.signal, undefined, { gate, fetch });
    abort.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches the real address, not the internal scheme', async () => {
    const gate = new RequestGate();
    const fetch = vi.fn(async () => res(200, 'tile'));
    await fetchTile('meshtile+https://tiles.example/v1/x.mvt?key=k', new AbortController().signal, undefined, { gate, fetch });
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe('https://tiles.example/v1/x.mvt?key=k');
  });

  it('puts the service error code in the message so the allowance can be told apart', async () => {
    const gate = new RequestGate();
    const fetch = vi.fn(async () => res(429, '{"error":{"code":"quota_exceeded"}}'));
    await expect(fetchTile('meshtile+https://t/1', new AbortController().signal, undefined, { gate, fetch })).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('quota_exceeded'),
    });
  });
});
