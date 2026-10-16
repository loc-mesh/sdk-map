/**
 * Which theme to paint, and when to change it.
 *
 * The Mesh tiles service paints five: two for daylight, two for night, and one
 * neutral for when the application's own data has to be the thing that stands
 * out. They are requested per style document; the squares, fonts and icons are
 * shared between them, so switching costs one small document and no new tile
 * requests.
 */

export type Theme = 'light' | 'white' | 'grayscale' | 'dark' | 'black';

export const DAY_THEMES: readonly Theme[] = ['light', 'white'];
export const NIGHT_THEMES: readonly Theme[] = ['dark', 'black'];

/**
 * 🔴 THE SWITCH POINT IS NOT SUNSET, AND GETTING THIS WRONG IS WORSE THAN NOT
 * DOING IT AT ALL. Switching at sunset leaves someone on a bright white screen
 * through the whole of dusk and then flips to night while it is still light
 * outside. The usable threshold is **civil twilight** — the sun six degrees
 * below the horizon — which is roughly when you would turn headlights on.
 */
const CIVIL_TWILIGHT_DEGREES = -6;

/**
 * The sun's elevation above the horizon, in degrees.
 *
 * ⚠️ Deliberately a small approximation rather than a dependency. It is
 * accurate to well under a degree, which decides the switch within a couple of
 * minutes of the exact moment — and nobody can perceive the difference, whereas
 * every consumer can perceive an extra package in their bundle.
 */
export function solarElevation(when: Date, latitude: number, longitude: number): number {
  const rad = Math.PI / 180;
  const dayMs = 86_400_000;
  // Days since the J2000.0 epoch.
  const d = when.getTime() / dayMs - 10957.5;

  const meanAnomaly = (357.5291 + 0.98560028 * d) * rad;
  const eclipticLongitude =
    (280.459 + 0.98564736 * d) * rad +
    (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.00000036 * d) * rad;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );

  const greenwichSiderealTime = (280.16 + 360.9856235 * d) * rad;
  const hourAngle = greenwichSiderealTime + longitude * rad - rightAscension;

  const lat = latitude * rad;
  const sinElevation =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);

  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / rad;
}

/** True when it is dark enough at this place and time to want a night theme. */
export function isNight(when: Date, latitude: number, longitude: number): boolean {
  return solarElevation(when, latitude, longitude) < CIVIL_TWILIGHT_DEGREES;
}

/**
 * The theme to use right now, given the pair the caller wants to alternate
 * between. Keeping both in the caller's hands matters: "dark" and "black" are
 * genuinely different choices, and so are "light" and "white".
 */
export function themeFor(
  when: Date,
  latitude: number,
  longitude: number,
  pair: { day: Theme; night: Theme },
): Theme {
  return isNight(when, latitude, longitude) ? pair.night : pair.day;
}
