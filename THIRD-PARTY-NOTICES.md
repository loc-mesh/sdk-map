# Third-party notices

What this package depends on, what those dependencies are licensed under, and
what we owe each of them.

⚠️ **Permissive is not obligation-free.** BSD-2-Clause, BSD-3-Clause, MIT and
ISC all require the copyright notice and licence text to be retained in
redistributions. Where a consumer installs a dependency transitively through
npm it arrives with its own `LICENSE` file and the obligation is discharged by
the registry. **If a build ever bundles or vendors one of these into our own
artifact, its notice must ship inside that artifact** — which is why this file
exists from the first commit rather than from the day someone remembers.

## Direct dependency

| Package | Licence | Why we depend on it |
|---|---|---|
| [`maplibre-gl`](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause | Renders the map. ⚠️ **MapLibre, never Mapbox GL JS v2 or later** — the latter requires a billed Mapbox account even when pointed at our own tiles, which would defeat the entire point of self-hosting the map. Pinned by `loc-mesh/design` ADR 0039. |

## Transitive dependencies

Audited 2026-10-16 across the whole declared tree of `maplibre-gl` 6.x. **No
copyleft or share-alike licence appears anywhere** — no GPL, LGPL, AGPL, MPL or
SSPL.

| Licence | Packages |
|---|---|
| ISC | `earcut`, `kdbush`, `potpack`, `tinyqueue`, `quickselect`, `@maplibre/geojson-vt`, `@mapbox/point-geometry`, `@maplibre/maplibre-gl-style-spec` |
| MIT | `bidi-js`, `gl-matrix`, `murmurhash-js`, `@types/geojson`, `@maplibre/vt-pbf` |
| BSD-3-Clause | `maplibre-gl`, `pbf`, `@mapbox/vector-tile` |
| BSD-2-Clause | `@mapbox/tiny-sdf`, `@mapbox/unitbezier` |
| MIT OR Apache-2.0 | `@maplibre/mlt` |

## Map data

The map itself is **OpenStreetMap** data, served by Locate2u Mesh under the
[Open Database Licence](https://opendatacommons.org/licenses/odbl/).

🔴 **The credit is a licence condition, not a courtesy, and it must reach the
person looking at the map.** This package therefore enables MapLibre's
attribution control and does not expose a way to switch it off. It may be
collapsed behind the small information icon — the OpenStreetMap Foundation's
guidelines permit that, provided it stays reachable — which is why compact mode
is the default presentation rather than a hidden one.

## Cartography

The map's styling comes from
[`@protomaps/basemaps`](https://github.com/protomaps/basemaps) (BSD-3-Clause).
It is **not** a dependency of this package: the style document is built and
served by the Mesh tiles service, so this package receives finished cartography
over HTTP rather than generating it. OpenMapTiles was rejected for the role
because its CC-BY terms would force a second visible credit line
(`loc-mesh/design` ADR 0037).

## Adding a dependency

A new runtime dependency is added **together with its licence, verified from
the registry rather than assumed, in the same change**. A dependency whose
licence is copyleft, share-alike, source-available or unstated is refused until
the owner rules on it. Pinned by `loc-mesh/design` ADR 0059 §5.
