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
import { discover, regionAt, type Published } from './discovery.js';
import { classify, type MeshMapError } from './errors.js';
import { themeFor, type Theme, type ThemeColours, type ThemeSetting } from './theme.js';
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

  /**
   * The theme: a preset name ('light', 'dark', …), your own colours over a
   * preset (`{ base: 'dark', colours: { water: '#1E2A44' } }`), or the address
   * of a JSON file holding that. Leave it out for the service's default.
   * ⚠️ An unknown preset or an unreadable file paints the default and reports
   * why through `onError` — it never leaves a blank map.
   */
  theme?: ThemeSetting;
  /**
   * Switch between a day and a night theme at civil twilight, for the map's
   * current centre. Off by default — a map that changes colour unasked is a
   * surprise. `true` pairs your `theme` (or the default) with the service's
   * first night preset; or name both, and either may be your own colours.
   */
  autoTheme?: boolean | { day: ThemeSetting; night: ThemeSetting };

  /** Shop and café labels. On by default. */
  pois?: boolean;
  /** Extruded buildings. Needs tilt and zoom 14+ to show anything. */
  buildings3d?: boolean;

  /**
   * Pin to one published region. Left out, the map shows the region containing
   * its centre and switches region as the person pans from one to another.
   */
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


export class MeshMap {
  /** The MapLibre map, for anything this control does not wrap. */
  readonly map: MapLibreMap;
  /** What the service said it has, and the region currently shown. */
  get published(): Published {
    return this._published;
  }
  private _published: Published;
  private painted: Painted = {};

  private readonly credential: Credential;
  private readonly origin: string;
  private readonly onError: (e: MeshMapError) => void;
  private readonly options: MeshMapOptions;
  private theme: ThemeSetting | undefined;
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
    theme: ThemeSetting | undefined;
    options: MeshMapOptions;
    onError: (e: MeshMapError) => void;
  }) {
    this.map = args.map;
    this._published = args.published;
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
    const published = await discover(baseUrl, { region: options.region, near: options.center });

    const credential = options.mapKey
      ? Credential.fromKey(options.mapKey, onError)
      : await Credential.fromMinter(options.getMapToken!, onError);

    const centre = options.center ?? [0, 0];
    const pair = resolvePair(options, published);
    const theme: ThemeSetting | undefined = pair
      ? themeFor(new Date(), centre[1], centre[0], pair)
      : options.theme;
    const painted = await resolveTheme(theme, published, onError);

    const map = new MapLibreMap({
      container: options.container,
      style: styleUrl(baseUrl, published, painted, options),
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
    self.painted = painted;

    // 🔴 FOLLOW THE VIEW ACROSS REGIONS, unless the page pinned one. Each region
    // is a separate map build, so a map that started over Sydney and is panned
    // to London would otherwise show London as empty ocean. Checked when a move
    // ENDS, never during one: a style swap mid-drag would stall the gesture.
    if (!options.region && published.regions.length > 1) {
      map.on('moveend', () => void self.followRegion());
    }

    // ⚠️ The handler that would have turned 2026-10-16's blank grey rectangle
    // into one sentence. MapLibre reports tile parse failures on this event and
    // nowhere else, and only if something is listening.
    map.on('error', (e: unknown) => self.onError(classify((e as { error?: unknown })?.error ?? e)));

    self.unsubscribeGate = gate.subscribe((state, resumesAt) => self.onGate(state, resumesAt));

    // Recorded before the page can add anything: the page only gets the map
    // once this function returns, and `load` fires after the style and sprite.
    map.once('load', () => self.recordMeshStyle());

    // Tell the page when the service could not use part of its theme. The map
    // still draws, so this is the only way anyone learns the water is not the
    // colour they asked for because a name was misspelt.
    map.on('style.load', () => self.reportThemeProblems());

    addControls(map, options.controls);

    if (pair) self.startAutoTheme(pair);
    return self;
  }

  /** Paint a different theme. Keeps the view, the pinned version and your own layers. */
  async setTheme(theme: ThemeSetting | undefined): Promise<void> {
    if (this.disposed || themeKey(theme) === themeKey(this.theme)) return;
    this.theme = theme;
    const painted = await resolveTheme(theme, this.published, this.onError);
    if (this.disposed) return;
    this.painted = painted;
    await this.restyle();
  }

  /** The region currently shown. */
  get region(): string {
    return this._published.region;
  }

  /** Show another published region. Keeps the theme and your own layers. */
  async setRegion(region: string): Promise<void> {
    const next = this._published.regions.find((r) => r.region === region);
    if (this.disposed || !next || next.region === this._published.region) return;
    this._published = { ...this._published, region: next.region, version: next.version };
    await this.restyle();
  }

  private async followRegion(): Promise<void> {
    const c = this.map.getCenter();
    const current = this._published.regions.find((r) => r.region === this._published.region);
    const inside = (b: [number, number, number, number] | null) =>
      !!b && c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3];
    if (inside(current?.bounds ?? null)) return;
    const there = regionAt(this._published.regions, c.lng, c.lat);
    if (there) await this.setRegion(there.region);
  }

  private async restyle(): Promise<void> {
    const url = styleUrl(this.options.tilesBaseUrl.replace(/\/$/, ''), this._published, this.painted, this.options);
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
  get currentTheme(): ThemeSetting {
    return this.theme ?? this.published.defaultTheme;
  }

  private reportThemeProblems(): void {
    const meta = (this.map.getStyle().metadata ?? {}) as Record<string, unknown>;
    const ignored = meta['locate2u:ignored-colours'];
    if (Array.isArray(ignored) && ignored.length) {
      this.onError({
        code: 'theme_colours_ignored',
        message:
          `These theme colours were not used: ${ignored.join(', ')}. Check each name against ` +
          '/api/themes/<preset> on the tiles service, and that each value is a hex, rgb or hsl colour.',
        fatal: false,
      });
    }
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

  private startAutoTheme(pair: { day: ThemeSetting | undefined; night: ThemeSetting }): void {
    // Every five minutes is far more often than needed to land the switch
    // within a few minutes of civil twilight, and costs nothing.
    this.autoThemeTimer = setInterval(() => {
      if (this.disposed) return;
      const c = this.map.getCenter();
      const want = themeFor(new Date(), c.lat, c.lng, pair);
      if (themeKey(want) !== themeKey(this.theme)) void this.setTheme(want);
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

function resolvePair(
  options: MeshMapOptions,
  published: Published,
): { day: ThemeSetting | undefined; night: ThemeSetting } | undefined {
  const auto = options.autoTheme;
  if (!auto) return undefined;
  if (auto === true) return { day: options.theme, night: published.nightThemes[0] ?? 'dark' };
  return auto;
}

/** What the style request will carry: a preset name, colours, or neither. */
interface Painted {
  name?: Theme;
  colours?: Record<string, unknown>;
}

const themeKey = (t: ThemeSetting | undefined): string => JSON.stringify(t ?? null);

/** Theme files already fetched this session, by address. */
const themeFiles = new Map<string, Promise<ThemeColours>>();

/** A plain preset name, as opposed to the address of a theme file. */
const isPresetName = (s: string) => /^[a-z0-9][a-z0-9_-]*$/i.test(s);

/**
 * Turn whatever the page passed into what the style request carries.
 *
 * ⚠️ NOTHING HERE THROWS. A theme is decoration, and a mistake in one must
 * never cost anyone their map. An unknown preset or an unreadable file is
 * reported through `onError` and the service's default is painted.
 */
async function resolveTheme(
  setting: ThemeSetting | undefined,
  published: Published,
  onError: (e: MeshMapError) => void,
): Promise<Painted> {
  if (setting === undefined || setting === null) return {};

  let own: ThemeColours | undefined;
  if (typeof setting === 'string') {
    if (isPresetName(setting)) return checkPreset(setting, published, onError);
    try {
      let file = themeFiles.get(setting);
      if (!file) {
        file = fetch(setting).then(async (res) => {
          if (!res.ok) throw new Error(`it answered ${res.status}`);
          return (await res.json()) as ThemeColours;
        });
        themeFiles.set(setting, file);
      }
      own = await file;
    } catch (err) {
      themeFiles.delete(setting);
      onError({
        code: 'theme_unreadable',
        message: `The theme file ${setting} could not be read: ${(err as Error).message}. Painting the default theme.`,
        fatal: false,
      });
      return {};
    }
  } else {
    own = setting;
  }

  if (!own || typeof own !== 'object' || !own.colours || typeof own.colours !== 'object') {
    onError({
      code: 'theme_unreadable',
      message:
        'A theme of your own needs a "colours" object, for example ' +
        '{ "base": "dark", "colours": { "water": "#1E2A44" } }. Painting the default theme.',
      fatal: false,
    });
    return {};
  }
  const base = own.base ? checkPreset(own.base, published, onError) : {};
  return { ...base, colours: own.colours };
}

function checkPreset(name: string, published: Published, onError: (e: MeshMapError) => void): Painted {
  // An empty list means an older service that published none: trust the name.
  if (published.themes.length && !published.themes.includes(name)) {
    onError({
      code: 'unknown_theme',
      message:
        `There is no "${name}" theme. The service offers: ${published.themes.join(', ')}. ` +
        `Painting ${published.defaultTheme}.`,
      fatal: false,
    });
    return {};
  }
  return { name };
}

/** base64url, because the colours travel in a URL. */
function encodeColours(colours: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(colours));
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  theme: Painted,
  options: MeshMapOptions,
): string {
  const u = new URL(
    `${baseUrl}/v1/${encodeURIComponent(published.region)}/${encodeURIComponent(published.version)}/style.json`,
  );
  // Neither set means the service's default, which is the point of leaving it out.
  if (theme.name) u.searchParams.set('flavour', theme.name);
  if (theme.colours) u.searchParams.set('colours', encodeColours(theme.colours));
  if (options.pois === false) u.searchParams.set('pois', 'false');
  if (options.buildings3d === true) u.searchParams.set('buildings3d', 'true');
  return u.toString();
}
