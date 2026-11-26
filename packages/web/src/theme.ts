/**
 * Which theme to paint, and when to change it.
 *
 * A theme is a list of colours. The service publishes named PRESETS, and a page
 * may supply its own colours laid over one. Both are requested per style
 * document; the squares, fonts and icons are shared between them, so switching
 * costs one small document and no new tile requests.
 *
 * ⚠️ A PRESET NAME IS A STRING, NOT A FIXED LIST. Presets are added to the
 * service over time and the service publishes which exist; a union type here
 * would refuse a preset the service already serves until this package was
 * released again.
 */

/** A preset name: 'light', 'white', 'grayscale', 'dark', 'black', or any preset added since. */
export type Theme = string;

/**
 * Your own theme: a preset to start from, and only the colours you want
 * different. The colour names and every current value are published at
 * the tiles service, at /api/themes/{preset}.
 */
export interface ThemeColours {
  /** The preset to start from. Leave it out for the service's default. */
  base?: Theme;
  /** Colour name to colour: hex, rgb(a) or hsl(a). */
  colours: Record<string, unknown>;
}

/**
 * What a page may pass as a theme: a preset name, its own colours, or the
 * address of a JSON file holding its own colours.
 */
export type ThemeSetting = Theme | ThemeColours;

/** The five presets every service has published since 1.0. Use the service's list for the current set. */
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
export function themeFor<T = Theme>(
  when: Date,
  latitude: number,
  longitude: number,
  pair: { day: T; night: T },
): T {
  return isNight(when, latitude, longitude) ? pair.night : pair.day;
}
