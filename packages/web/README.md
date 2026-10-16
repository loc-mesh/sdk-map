# @locate2u/mesh-map

**Put a map on a page.** The map control for the [Locate2u Mesh](https://locate2u.com) platform — Locate2u serves its own map imagery from OpenStreetMap data, and this draws it.

```bash
npm install @locate2u/mesh-map
```

> 🚧 **Beta.** Published under the `beta` tag while the interface settles. Pin an exact version until this reaches 1.0.

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

Five, painted by the service: `light` and `white` for daylight, `dark` and `black` for night, and `grayscale` for when your own data has to be the thing that stands out.

```js
await map.setTheme('dark');
```

Switching costs one small document and **no new tile requests** — the squares, fonts and icons are shared between themes.

### Day and night, automatically

```js
MeshMap.create({ ..., autoTheme: { day: 'light', night: 'black' } });
```

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
  //   token_refresh_failed  the map will go dark when the current token expires
  // e.fatal says whether the map is still usable.
}
```

Credentials are stripped from every error before it reaches you.

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
| `theme` | `theme` | `light` | One of the five |
| `autoTheme` | `auto-theme` | off | Day/night at civil twilight |
| `pois` | `pois` | `true` | Shop and café labels |
| `buildings3d` | `buildings-3d` | `false` | Needs tilt and zoom 14+ |
| `region` | `region` | first published | Pin to a named region |
| `onError` | — | logs | Strongly recommended |

## What this package does not do

It knows nothing about stops, runs, drivers or any other Mesh resource, and it never fetches one. **Hand it geometry and it draws it.**

That boundary is deliberate: Locate2u Mesh is a platform rather than a product, and a control that fetched your runs for you would be shipping product. Recipes for drawing Mesh data on this map live in the Mesh developer documentation, where you copy them and own them.

## Attribution

The map is OpenStreetMap data under the Open Database Licence, and the credit is a **licence condition** that has to reach the person looking at the map. This control enables MapLibre's attribution control and gives you no way to switch it off. It may be collapsed behind the small information icon, which is the default here.

See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

## Licence

MIT. Built and maintained by [Locate2u](https://locate2u.com).
