import { describe, expect, it } from 'vitest';
import { isNight, solarElevation, themeFor } from '../src/theme';

const BRISBANE = { lat: -27.4698, lng: 153.0251 };

/**
 * ⚠️ THE THRESHOLD IS CIVIL TWILIGHT, NOT SUNSET. Switching at sunset leaves
 * someone on a bright white screen through the whole of dusk and then flips to
 * night while it is still light outside.
 */
describe('solar elevation', () => {
  it('puts the sun up at local midday and down at local midnight', () => {
    // Brisbane is UTC+10 and does not observe daylight saving.
    const midday = new Date('2026-06-21T02:00:00Z');
    const midnight = new Date('2026-06-21T14:00:00Z');
    expect(solarElevation(midday, BRISBANE.lat, BRISBANE.lng)).toBeGreaterThan(20);
    expect(solarElevation(midnight, BRISBANE.lat, BRISBANE.lng)).toBeLessThan(-30);
  });

  it('knows the southern hemisphere from the northern at the same instant', () => {
    const t = new Date('2026-06-21T02:00:00Z');
    // Midday in Brisbane is the small hours in London.
    expect(solarElevation(t, BRISBANE.lat, BRISBANE.lng)).toBeGreaterThan(
      solarElevation(t, 51.5072, -0.1276),
    );
  });

  it('switches on darkness rather than on the clock', () => {
    expect(isNight(new Date('2026-06-21T02:00:00Z'), BRISBANE.lat, BRISBANE.lng)).toBe(false);
    expect(isNight(new Date('2026-06-21T14:00:00Z'), BRISBANE.lat, BRISBANE.lng)).toBe(true);
  });

  it('hands back whichever pair the caller chose, not a built-in one', () => {
    const night = new Date('2026-06-21T14:00:00Z');
    expect(themeFor(night, BRISBANE.lat, BRISBANE.lng, { day: 'white', night: 'black' })).toBe(
      'black',
    );
    expect(themeFor(night, BRISBANE.lat, BRISBANE.lng, { day: 'light', night: 'dark' })).toBe(
      'dark',
    );
  });

  it('stays finite at the poles and across the date line rather than throwing', () => {
    const places: Array<[number, number]> = [
      [89.9, 179.9],
      [-89.9, -179.9],
      [0, 0],
    ];
    for (const [lat, lng] of places) {
      const v = solarElevation(new Date('2026-10-16T06:00:00Z'), lat, lng);
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(90.001);
    }
  });
});
