# @locate2u/mesh-map

**Put a map on a page.** The map control for the [Locate2u Mesh](https://locate2u.com) platform — Locate2u serves its own map imagery from OpenStreetMap data, and this draws it.

```bash
npm install @locate2u/mesh-map
```

## The smallest thing that works

```html
<script type="module">
  import '@locate2u/mesh-map/element';
</script>

<mesh-map
  tiles-base-url="https://tiles-api.mesh.locate2u.app"
  map-key="mk_live_your_key"
  center="153.0251,-27.4698"
  zoom="14"
  style="display:block; height:400px"
></mesh-map>
```

That is the whole integration. It works in React, Vue, Angular, Svelte and a plain HTML file, because it is a custom element rather than a framework component.

⚠️ **Give it a height.** The element has none of its own, and a map in a zero-pixel box looks like a page that failed to load while reporting nothing.

## Or in code

```js
import { MeshMap } from '@locate2u/mesh-map';

const map = await MeshMap.create({
  container: 'map',
  tilesBaseUrl: 'https://tiles-api.mesh.locate2u.app',
  mapKey: 'mk_live_your_key',
  center: [153.0251, -27.4698],
  zoom: 14,
  theme: 'light',
  onError: (e) => console.warn(e.code, e.message),
});

// Anything this control does not wrap, reach through to MapLibre for:
map.map.addSource('my-route', { type: 'geojson', data: myLineString });
```

## Themes

A theme is a list of colours. The `theme` option takes one of three things:

```js
MeshMap.create({ ..., theme: 'dark' });                       // a preset, by name
MeshMap.create({ ..., theme: { base: 'dark', colours: { water: '#1E2A44', highway: '#4F8BFF' } } });  // your own colours over a preset
MeshMap.create({ ..., theme: '/brand/map-theme.json' });       // the same, from a file
await map.setTheme('black');                                   // change it later
```

**Leave `theme` out and the service's default is painted.** The presets today are `light` and `white` for daylight, `dark` and `black` for night, and `grayscale` for when your own data has to stand out. **More are added over time**; the tiles service lists the current set at `/api`, and the control picks new ones up with no upgrade.

**Your own theme only lists what is different.** Every colour name, with each preset's current value, is at `<tiles service>/api/themes/<preset>` — copy that, keep what you want to change, and set `base` to the preset you started from. Leave `base` out to start from the default.

⚠️ **A mistake never blanks the map.** An unknown preset or an unreadable file paints the default and reports `unknown_theme` or `theme_unreadable` through `onError`; a misspelt colour name is skipped and reported as `theme_colours_ignored`, and the rest still apply.

Switching costs one small document and **no new tile requests** — the squares, fonts and icons are shared between themes. **Your own sources, layers and images are kept**, in the same order, from 1.1.0; before that a switch, including the automatic one at dusk, removed them.

### Day and night, automatically

```js
MeshMap.create({ ..., autoTheme: { day: 'light', night: 'black' } });
MeshMap.create({ ..., theme: '/brand/day.json', autoTheme: true });   // your day theme, the service's night preset
```

Either side may be a preset name, your own colours, or a file.

⚠️ **It switches at civil twilight, not at sunset.** Sunset leaves a driver on a bright white screen through the whole of dusk and then flips to night while it is still light outside. The threshold is the sun six degrees below the horizon — roughly when you would turn headlights on.

## Credentials

A **map key** is safe in front-end code: it is origin-locked, issued per tenant, and revocable.

```js
MeshMap.create({ ..., mapKey: 'mk_live_...' });
```

A **map token** is short-lived — four hours by default — and is minted by *your* backend:

```js
MeshMap.create({
  ...,
  getMapToken: async () => {
    const r = await fetch('/api/my-backend/map-token');
    return r.json();            // { token, expiresAt }
  },
});
```

🔴 **Never mint a map token in the browser.** Minting needs a Mesh bearer token, and a bearer token in front-end code is a credential leak.

This package refreshes a token at 80% of its life, so a map does not go blank part-way through a shift. That is most of the reason to use it rather than forty lines of your own.

## Knowing why a map is blank

🔴 **Almost every map failure answers HTTP 200.** A grey rectangle looks identical to an empty ocean, the page does not crash, and the console stays quiet. So this control always reports a cause:

```js
onError: (e) => {
  // e.code is one of:
  //   credential_rejected   the key or token was refused
  //   module_not_enabled    valid credential, Maps module not on for this tenant
  //   no_map_data           nothing published for this environment
  //   discovery_failed      could not ask the service what it serves
  //   tile_unreadable       a square arrived and could not be parsed
  //   quota_exceeded        over the allowance for this period
  //   rate_limited          too many squares in the last minute; clears itself
  //   token_refresh_failed  the map will go dark when the current token expires
  // e.fatal says whether the map is still usable.
}
```

Credentials are stripped from every error before it reaches you.

### When the service says "too many"

If the tiles service answers 429, the control stops requesting map squares for
ten seconds — however much the person drags — then sends one request to check.
If that is refused it waits another ten seconds; if it succeeds, loading
resumes on its own. While it waits, a short notice over the map says so and
counts down. Restyle it with the `.mesh-map-notice` class, or turn it off with
`rateLimitNotice: false` (requests still pause either way).

With the custom element, the same thing arrives as a DOM event:

```js
document.addEventListener('mesh-map-error', (e) => console.warn(e.detail.code));
```

## Options

| Option | Attribute | Default | |
|---|---|---|---|
| `tilesBaseUrl` | `tiles-base-url` | — | Tiles service origin, **no path** |
| `mapKey` | `map-key` | — | Or use `getMapToken` |
| `getMapToken` | — | — | Mint a short-lived token from your backend |
| `center` | `center` | `0,0` | `[lng, lat]` in code; `"lng,lat"` as an attribute |
| `zoom` / `pitch` / `bearing` | same | `11` / `0` / `0` | |
| `theme` | `theme` | the service default | A preset name, your own colours, or a theme file address |
| `autoTheme` | `auto-theme` | off | Day/night at civil twilight |
| `pois` | `pois` | `true` | Shop and café labels |
| `buildings3d` | `buildings-3d` | `false` | Needs tilt and zoom 14+ |
| `region` | `region` | the whole world | Pin to one region; left out, the map shows the world with every region on top |
| `controls` | `navigation-control`, `fullscreen-control`, `geolocate-control`, `scale-control` | none | Standard buttons, each in the corner you name |
| `onError` | — | logs | Strongly recommended |

## Regions

Each region the platform serves (Australia, the United Kingdom and Japan today) is a detailed map build, drawn on top of a low-detail map of the whole world. **Leave `region` out** and you get all of it in one map: zoom out from Brisbane to the whole planet, pan to Tokyo, and zoom in again, with every region's street-level detail where it exists and coastlines, borders, cities and major roads everywhere else. Up to zoom 7 the world map is drawn; from zoom 7 each region's own detail covers it inside that region. **Set `region`** to draw one region only (still with the world beneath it). `map.region` says which is shown (`'world'` for the whole map), `map.setRegion(name)` changes it and `map.setRegion('world')` goes back, and `map.published.regions` lists the regions with their bounds.

## Buttons, and which corner they sit in

```js
MeshMap.create({
  ...,
  controls: { navigation: 'bottom-right', fullscreen: 'top-right', geolocate: 'bottom-right', scale: true },
});
```

Each takes `top-left`, `top-right`, `bottom-left` or `bottom-right`; `true` means its usual corner. On the element: `<mesh-map navigation-control="bottom-left" fullscreen-control>`. The OpenStreetMap credit stays bottom-right and cannot be moved.

## Tilting and rotating

`pitch` (0 is straight down, up to 85) and `bearing` (degrees from north) set the starting view, and `map.map.easeTo({ pitch: 60, bearing: 90 })` changes it. People tilt and rotate by dragging with the right mouse button, or with two fingers on a touch screen. The compass on the navigation button turns the map back to north.

## Pins, groups, pop-ups and events

`Marker`, `Popup`, `LngLatBounds` and the button controls are re-exported from this package. Import them from here rather than from `maplibre-gl`, so they come from the same copy of MapLibre the map uses.

Worked examples are at **https://docs.mesh.locate2u.app/modules/maps/recipes/**: your own SVG pins, colour by type, grouping thousands of pins, hover, click and selected, and following a driver in a tilted view.

## What this package does not do

It knows nothing about stops, runs, drivers or any other Mesh resource, and it never fetches one. **Hand it geometry and it draws it.**

That boundary is deliberate: Locate2u Mesh is a platform rather than a product, and a control that fetched your runs for you would be shipping product. Recipes for drawing Mesh data on this map live in the Mesh developer documentation, where you copy them and own them.

## Attribution

The map is OpenStreetMap data under the Open Database Licence, and the credit is a **licence condition** that has to reach the person looking at the map. This control enables MapLibre's attribution control and gives you no way to switch it off. It may be collapsed behind the small information icon, which is the default here.

See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

## Licence

MIT. Built and maintained by [Locate2u](https://locate2u.com).
