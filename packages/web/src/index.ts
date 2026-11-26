/**
 * @locate2u/mesh-map — the Locate2u Mesh map control.
 *
 * Two ways in. `MeshMap.create()` for application code that wants the object,
 * and `<mesh-map>` for markup — import `@locate2u/mesh-map/element` to register
 * it.
 *
 * ⚠️ This package draws maps. It knows nothing about stops, runs or drivers and
 * never fetches one: hand it geometry and it renders it. That boundary is set
 * by design ADR 0059 §4 and is not an oversight.
 */

export {
  MeshMap,
  type MeshMapOptions,
  type MeshMapControls,
  type ControlSetting,
  type ControlPosition,
} from './map.js';

// The MapLibre classes a page needs to draw its own things (pins, popups, extra
// buttons), re-exported so they come from THE SAME copy of MapLibre the map was
// built with. Importing them from 'maplibre-gl' directly can resolve a different
// major version (see the pin note in map.ts), which compiles and then misbehaves.
export {
  Marker,
  Popup,
  LngLatBounds,
  NavigationControl,
  FullscreenControl,
  GeolocateControl,
  ScaleControl,
  type IControl,
  type MapMouseEvent,
  type MapGeoJSONFeature,
  type GeoJSONSource,
} from 'maplibre-gl';
export { discover, type Published } from './discovery.js';
export { Credential, type TokenMinter, type MintedToken } from './credentials.js';
export {
  classify,
  redact,
  type MeshMapError,
  type MeshMapErrorCode,
} from './errors.js';
export {
  solarElevation,
  isNight,
  themeFor,
  DAY_THEMES,
  NIGHT_THEMES,
  type Theme,
} from './theme.js';
