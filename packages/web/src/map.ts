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

// 🔴 MAPLIBRE 5, NOT 6, AND THE PIN IS LOAD-BEARING. Version 6 moved the web
// worker into a separate file whose name it computes at runtime
// (`dev ? "maplibre-gl-worker-dev.mjs" : "maplibre-gl-worker.mjs"`). A bundler
// cannot statically see that, so it never emits the file — and the failure is
// vicious: a dev server resolves it fine, a production build does not, and the
// missing path is answered by the single-page-app fallback with index.html and
// a 200. MapLibre reports "Worker failed to load", the map draws nothing, and
// the network tab shows no failed request at all.
//
// Measured 2026-10-16 against the published package in a stock Vite app:
// with 6.14.0, 0 layers drew; with 5.24.0, 52 drew and 29 street names
// rendered. Version 5 inlines the worker, so any bundler produces a working
// build with no configuration from the customer — which is the entire job of
// this package.
//
// ⚠️ Do not widen this range to `^5 || ^6` hoping for the best. npm would
// resolve 6 and every consumer would get a blank map.
//
// ⚠️ Named import, never a default: v6 removed the default export, and if this
// package ever does move to 6 the default form compiles and is undefined at
// runtime.
import {
  Map as MapLibreMap,
  NavigationControl,
  FullscreenControl,
  GeolocateControl,
  ScaleControl,
  type ControlPosition,
  type IControl,
} from 'maplibre-gl';

/** The style document shape, taken from the library rather than named separately. */
type StyleSpecification = ReturnType<MapLibreMap['getStyle']>;

/** A corner of the map: `top-left`, `top-right`, `bottom-left` or `bottom-right`. */
export type { ControlPosition };

/**
 * One of the standard buttons. `true` puts it in its usual corner, a corner
 * name puts it there, and `false` or leaving it out means no button.
 */
export type ControlSetting = boolean | ControlPosition;

export interface MeshMapControls {
  /** Zoom in, zoom out, and a compass that turns the map back to north and flat when clicked. Usual corner: top-right. */
  navigation?: ControlSetting;
  /** Fill the screen with the map. Usual corner: top-right. */
  fullscreen?: ControlSetting;
  /** Centre on the device's own location, with the browser's permission. Usual corner: top-right. */
  geolocate?: ControlSetting;
  /** A distance scale bar. Usual corner: bottom-left. */
  scale?: ControlSetting;
}
import { Credential, transformRequest, type TokenMinter } from './credentials.js';
import { discover, type Published } from './discovery.js';
import { classify, type MeshMapError } from './errors.js';
import { themeFor, type Theme } from './theme.js';
import { gate, type GateState } from './pause.js';
import { registerTileProtocol, rewrite } from './tile-fetch.js';

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

  /**
   * Show a short notice over the map while tile requests are paused because the
   * service answered 429. On by default. Requests pause either way; this only
   * controls whether the person looking at the map is told why.
   */
  rateLimitNotice?: boolean;

  /**
   * The standard buttons, each in the corner you choose. None by default. For
   * anything else, add a MapLibre control yourself with `map.map.addControl`.
   */
  controls?: MeshMapControls;

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
  private notice: HTMLDivElement | undefined;
  private noticeTimer: ReturnType<typeof setInterval> | undefined;
  private unsubscribeGate: (() => void) | undefined;
  // What the SERVICE put on the map, as opposed to what the page added. Needed
  // so a theme switch can carry the page's own layers, sources and images
  // across — see `setTheme`.
  private meshSources = new Set<string>();
  private meshLayers = new Set<string>();
  private meshImages = new Set<string>();

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
      transformRequest: gatedTransform(transformRequest(origin, () => credential.current), origin),
    });

    const self = new MeshMap({ map, published, credential, origin, theme, options, onError });

    // ⚠️ The handler that would have turned 2026-10-16's blank grey rectangle
    // into one sentence. MapLibre reports tile parse failures on this event and
    // nowhere else, and only if something is listening.
    map.on('error', (e: unknown) => self.onError(classify((e as { error?: unknown })?.error ?? e)));

    self.unsubscribeGate = gate.subscribe((state, resumesAt) => self.onGate(state, resumesAt));

    // Recorded before the page can add anything: the page only gets the map
    // once this function returns, and `load` fires after the style and sprite.
    map.once('load', () => self.recordMeshStyle());

    addControls(map, options.controls);

    if (options.autoTheme && pair) self.startAutoTheme(pair);
    return self;
  }

  /** Paint a different theme. Keeps the view, the pinned version and your own layers. */
  async setTheme(theme: Theme): Promise<void> {
    if (this.disposed || theme === this.theme) return;
    this.theme = theme;
    const url = styleUrl(this.options.tilesBaseUrl.replace(/\/$/, ''), this.published, theme, this.options);
    // 🔴 THE PAGE'S OWN LAYERS MUST SURVIVE THIS. A new style replaces every
    // source, layer and image on the map, so before 1.1.0 a theme switch —
    // including the automatic one at dusk — silently removed every pin a page
    // had drawn, while the documentation promised the opposite. Measured
    // 2026-11-26. Whatever the service did not put there is carried across.
    const images = this.userImages();
    const ready = new Promise<void>((resolve) => this.map.once('style.load', () => resolve()));
    // `diff: false` because the two documents share no layer ids worth
    // reconciling; a full swap is both faster and more predictable.
    this.map.setStyle(url, {
      diff: false,
      transformStyle: (previous, next) => this.carryAcross(previous, next),
    });
    await ready;
    for (const { id, image } of images) {
      if (!this.map.hasImage(id)) {
        this.map.addImage(id, image.data, { pixelRatio: image.pixelRatio, sdf: image.sdf });
      }
    }
  }

  private recordMeshStyle(): void {
    const style = this.map.getStyle();
    this.meshSources = new Set(Object.keys(style.sources ?? {}));
    this.meshLayers = new Set((style.layers ?? []).map((l) => l.id));
    this.meshImages = new Set(this.map.listImages());
  }

  /** Images the page added, captured before a style swap discards them. */
  private userImages(): { id: string; image: NonNullable<ReturnType<MapLibreMap['getImage']>> }[] {
    const out: { id: string; image: NonNullable<ReturnType<MapLibreMap['getImage']>> }[] = [];
    for (const id of this.map.listImages()) {
      if (this.meshImages.has(id)) continue;
      const image = this.map.getImage(id);
      if (image) out.push({ id, image });
    }
    return out;
  }

  /**
   * The new theme's style, plus every source and layer the page added to the
   * old one. A page layer keeps its place relative to the service's layers: it
   * goes in front of whichever service layer followed it before.
   */
  private carryAcross(
    previous: StyleSpecification | undefined,
    next: StyleSpecification,
  ): StyleSpecification {
    const meshSources = this.meshSources;
    const meshLayers = this.meshLayers;
    // The next style is the service's; record it now so the following switch
    // knows what is ours.
    this.meshSources = new Set(Object.keys(next.sources ?? {}));
    this.meshLayers = new Set((next.layers ?? []).map((l) => l.id));
    if (!previous) return next;

    const sources = { ...next.sources };
    for (const [id, source] of Object.entries(previous.sources ?? {})) {
      if (!meshSources.has(id) && !(id in sources)) {
        sources[id] = source;
        this.meshSources.delete(id);
      }
    }

    const layers = [...(next.layers ?? [])];
    const prev = previous.layers ?? [];
    prev.forEach((layer, i) => {
      if (meshLayers.has(layer.id) || layers.some((l) => l.id === layer.id)) return;
      const following = prev.slice(i + 1).find((l) => meshLayers.has(l.id));
      const at = following ? layers.findIndex((l) => l.id === following.id) : -1;
      if (at === -1) layers.push(layer);
      else layers.splice(at, 0, layer);
      this.meshLayers.delete(layer.id);
    });

    return { ...next, sources, layers };
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
    this.unsubscribeGate?.();
    this.hideNotice();
    this.credential.dispose();
    this.map.remove();
  }

  private onGate(state: GateState, resumesAt: number | undefined): void {
    if (this.disposed) return;
    if (state === 'open') return this.hideNotice();
    if (state !== 'paused' || this.options.rateLimitNotice === false) return;
    this.showNotice(resumesAt ?? Date.now());
  }

  /** A plain notice over the map; the page can restyle it through `.mesh-map-notice`. */
  private showNotice(resumesAt: number): void {
    if (!this.notice) {
      const el = document.createElement('div');
      el.className = 'mesh-map-notice';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      Object.assign(el.style, {
        position: 'absolute',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '10',
        padding: '8px 14px',
        borderRadius: '6px',
        background: 'rgba(11, 15, 26, 0.85)',
        color: '#fff',
        font: '14px/1.4 system-ui, sans-serif',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      });
      this.map.getContainer().appendChild(el);
      this.notice = el;
    }
    const el = this.notice;
    const render = () => {
      const s = Math.max(1, Math.ceil((resumesAt - Date.now()) / 1000));
      el.textContent = `Too many map requests. Trying again in ${s} second${s === 1 ? '' : 's'}…`;
    };
    render();
    if (this.noticeTimer) clearInterval(this.noticeTimer);
    this.noticeTimer = setInterval(render, 1000);
  }

  private hideNotice(): void {
    if (this.noticeTimer) clearInterval(this.noticeTimer);
    this.noticeTimer = undefined;
    this.notice?.remove();
    this.notice = undefined;
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

/**
 * Route map squares for the tiles service through the gated fetch in
 * `tile-fetch.ts`, after the credential has been added. Everything else — the
 * style, fonts, icons, any third-party source — goes untouched.
 */
function gatedTransform(
  inner: (url: string) => { url: string },
  origin: string,
): (url: string, resourceType?: string) => { url: string } {
  registerTileProtocol();
  return (url, resourceType) => {
    const out = inner(url);
    if (resourceType === 'Tile' && url.startsWith(origin)) return { url: rewrite(out.url) };
    return out;
  };
}

const USUAL_CORNER: Record<keyof MeshMapControls, ControlPosition> = {
  navigation: 'top-right',
  fullscreen: 'top-right',
  geolocate: 'top-right',
  scale: 'bottom-left',
};

const CORNERS = new Set<string>(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

function addControls(map: MapLibreMap, controls: MeshMapControls | undefined): void {
  if (!controls) return;
  const make: Record<keyof MeshMapControls, () => IControl> = {
    navigation: () => new NavigationControl({ visualizePitch: true }),
    fullscreen: () => new FullscreenControl(),
    geolocate: () => new GeolocateControl({ trackUserLocation: true }),
    scale: () => new ScaleControl(),
  };
  for (const name of Object.keys(make) as (keyof MeshMapControls)[]) {
    const setting = controls[name];
    if (!setting) continue;
    const corner = setting === true || !CORNERS.has(setting) ? USUAL_CORNER[name] : setting;
    map.addControl(make[name](), corner);
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
