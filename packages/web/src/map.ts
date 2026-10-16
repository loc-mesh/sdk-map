/**
 * The map control.
 *
 * What this exists to stop every customer re-deriving, measured from a real
 * application built against Mesh on 2026-10-16 with no help:
 *
 *   - that region and version are unguessable and come from `GET /api`
 *   - that the credential has to be threaded into generated sub-requests
 *   - that the library must be MapLibre and not Mapbox GL JS, for licence
 *     reasons rather than taste
 *   - that a session should pin the version it discovered
 *   - that a short-lived token has to be refreshed before it expires
 *   - that a blank map needs to say WHY, because every failure here answers 200
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO. It knows nothing about stops, runs,
 * drivers or any other Mesh resource, and it never fetches one. It draws what
 * it is handed. A control that fetched your runs for you would be a product
 * surface rather than a platform one — design ADR 0059 §4 and `scope.md`.
 */

// ⚠️ Named imports, not a default. MapLibre dropped its default export in v6;
// `import maplibregl from "maplibre-gl"` compiles under older typings and is
// undefined at runtime, which fails as "maplibregl.Map is not a constructor"
// at the one moment you are trying to draw a map.
import { Map as MapLibreMap } from 'maplibre-gl';

/** The style document shape, taken from the library rather than named separately. */
type StyleSpecification = ReturnType<MapLibreMap['getStyle']>;
import { Credential, transformRequest, type TokenMinter } from './credentials.js';
import { discover, type Published } from './discovery.js';
import { classify, type MeshMapError } from './errors.js';
import { themeFor, type Theme } from './theme.js';

export interface MeshMapOptions {
  /** The element to draw in, or its id. */
  container: HTMLElement | string;
  /** Origin of the Mesh tiles service, e.g. https://tiles-api.mesh.locate2u.app — no path. */
  tilesBaseUrl: string;

  /** A Mesh map key. Safe in front-end code: origin-locked, per tenant, revocable. */
  mapKey?: string;
  /**
   * Or a function that mints a short-lived map token from YOUR backend.
   * ⚠️ Never mint one in the browser — that needs a Mesh bearer token, and a
   * bearer token in front-end code is a credential leak.
   */
  getMapToken?: TokenMinter;

  /** Starting view. */
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;

  /** One of the five the service paints. Unknown values fall back to `light`. */
  theme?: Theme;
  /**
   * Switch between a day and a night theme at civil twilight, for the map's
   * current centre. Off by default — a map that changes colour unasked is a
   * surprise.
   */
  autoTheme?: boolean | { day: Theme; night: Theme };

  /** Shop and café labels. On by default. */
  pois?: boolean;
  /** Extruded buildings. Needs tilt and zoom 14+ to show anything. */
  buildings3d?: boolean;

  /** Pin to a particular published region instead of the first one offered. */
  region?: string;

  /** Told why the map is not drawing. Strongly recommended — see `errors.ts`. */
  onError?: (error: MeshMapError) => void;
}

const DEFAULT_PAIR = { day: 'light' as Theme, night: 'dark' as Theme };

export class MeshMap {
  /** The MapLibre map, for anything this control does not wrap. */
  readonly map: MapLibreMap;
  /** What the service said it had when this session started. */
  readonly published: Published;

  private readonly credential: Credential;
  private readonly origin: string;
  private readonly onError: (e: MeshMapError) => void;
  private readonly options: MeshMapOptions;
  private theme: Theme;
  private autoThemeTimer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  private constructor(args: {
    map: MapLibreMap;
    published: Published;
    credential: Credential;
    origin: string;
    theme: Theme;
    options: MeshMapOptions;
    onError: (e: MeshMapError) => void;
  }) {
    this.map = args.map;
    this.published = args.published;
    this.credential = args.credential;
    this.origin = args.origin;
    this.theme = args.theme;
    this.options = args.options;
    this.onError = args.onError;
  }

  /**
   * Create a map. Asynchronous because it asks the service what it can serve
   * before drawing anything — see `discovery.ts` for why that is not optional.
   */
  static async create(options: MeshMapOptions): Promise<MeshMap> {
    const onError = options.onError ?? ((e) => console.error(`[mesh-map] ${e.code}: ${e.message}`));

    if (!options.mapKey && !options.getMapToken) {
      const e: MeshMapError = {
        code: 'credential_rejected',
        message:
          'A map key or a getMapToken function is required. Mesh maps are metered per tenant, so ' +
          'there is no anonymous mode.',
        fatal: true,
      };
      onError(e);
      throw e;
    }

    const baseUrl = options.tilesBaseUrl.replace(/\/$/, '');
    const origin = new URL(baseUrl).origin;
    const published = await discover(baseUrl, { region: options.region });

    const credential = options.mapKey
      ? Credential.fromKey(options.mapKey, onError)
      : await Credential.fromMinter(options.getMapToken!, onError);

    const centre = options.center ?? [0, 0];
    const pair = resolvePair(options.autoTheme);
    const theme =
      options.autoTheme && pair
        ? themeFor(new Date(), centre[1], centre[0], pair)
        : (options.theme ?? 'light');

    const map = new MapLibreMap({
      container: options.container,
      style: styleUrl(baseUrl, published, theme, options),
      center: centre,
      zoom: options.zoom ?? 11,
      pitch: options.pitch ?? 0,
      bearing: options.bearing ?? 0,
      // 🔴 NOT CONFIGURABLE, AND THAT IS THE POINT. The OpenStreetMap credit is
      // a licence obligation that has to reach the person looking at the map.
      // Putting it here rather than in each application is what stops it being
      // lost by somebody who never knew it was required. Compact is permitted:
      // the OSMF guidelines allow it behind an information icon.
      attributionControl: { compact: true },
      transformRequest: transformRequest(origin, () => credential.current),
    });

    const self = new MeshMap({ map, published, credential, origin, theme, options, onError });

    // ⚠️ The handler that would have turned 2026-10-16's blank grey rectangle
    // into one sentence. MapLibre reports tile parse failures on this event and
    // nowhere else, and only if something is listening.
    map.on('error', (e: unknown) => self.onError(classify((e as { error?: unknown })?.error ?? e)));

    if (options.autoTheme && pair) self.startAutoTheme(pair);
    return self;
  }

  /** Paint a different theme. Keeps the view, the pinned version and your own layers. */
  async setTheme(theme: Theme): Promise<void> {
    if (this.disposed || theme === this.theme) return;
    this.theme = theme;
    const url = styleUrl(this.options.tilesBaseUrl.replace(/\/$/, ''), this.published, theme, this.options);
    // `diff: false` because the two documents share no layer ids worth
    // reconciling; a full swap is both faster and more predictable.
    this.map.setStyle(url, { diff: false });
    await new Promise<void>((resolve) => this.map.once('styledata', () => resolve()));
  }

  /** The theme currently painted. */
  get currentTheme(): Theme {
    return this.theme;
  }

  /**
   * The style document as the service built it, for callers that want to read
   * `metadata` or insert their own layers at a particular point.
   */
  get style(): StyleSpecification {
    return this.map.getStyle();
  }

  /** Stop timers and release the map. Safe to call twice. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.autoThemeTimer) clearInterval(this.autoThemeTimer);
    this.credential.dispose();
    this.map.remove();
  }

  private startAutoTheme(pair: { day: Theme; night: Theme }): void {
    // Every five minutes is far more often than needed to land the switch
    // within a few minutes of civil twilight, and costs nothing.
    this.autoThemeTimer = setInterval(() => {
      if (this.disposed) return;
      const c = this.map.getCenter();
      const want = themeFor(new Date(), c.lat, c.lng, pair);
      if (want !== this.theme) void this.setTheme(want);
    }, 5 * 60 * 1000);
  }
}

function resolvePair(auto: MeshMapOptions['autoTheme']): { day: Theme; night: Theme } | undefined {
  if (!auto) return undefined;
  return auto === true ? DEFAULT_PAIR : auto;
}

/**
 * 🔴 THE EXPLICIT VERSION, NEVER THE WORD "current". Resolving `current` on
 * every style request means a build publishing underneath a live page leaves
 * the browser holding a style that no longer matches the squares it is
 * fetching. `discover` resolved it once; everything after uses what it found.
 */
function styleUrl(
  baseUrl: string,
  published: Published,
  theme: Theme,
  options: MeshMapOptions,
): string {
  const u = new URL(
    `${baseUrl}/v1/${encodeURIComponent(published.region)}/${encodeURIComponent(published.version)}/style.json`,
  );
  u.searchParams.set('flavour', theme);
  if (options.pois === false) u.searchParams.set('pois', 'false');
  if (options.buildings3d === true) u.searchParams.set('buildings3d', 'true');
  return u.toString();
}
