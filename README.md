# sdk-map

**The Locate2u Mesh map controls — the thing a customer installs to put a map in their own application.**

| Platform | Package | Registry | Status |
|---|---|---|---|
| Browser | [`@locate2u/mesh-map`](packages/web) | npm | 🚧 beta |
| Android | `com.locate2u:mesh-map` | Maven Central | reserved, not built |
| WPF | `Locate2u.Mesh.Map` | NuGet | reserved, not built |

Locate2u Mesh serves its **own** map imagery, built from OpenStreetMap data, rather than buying it from a commercial maps vendor per request. These controls draw it.

## Why this exists

On 2026-10-16 an agent with access to the Mesh MCP server and nothing else built a working application against the platform. To put a map on a page it had to independently work out that region and version are unguessable path segments, that a credential has to be threaded into every generated sub-request, that the library must be MapLibre for licence reasons, and that a session should pin the version it discovered.

It got two things wrong, and both failed silently: its error handling surfaced only failures carrying an HTTP status, so a blank grey rectangle reported *"Loaded from Mesh"*; and it never discovered the five themes, because nothing told it.

**Every one of those is something each customer would otherwise re-derive, and most of them fail with a 200.** That is what this repository removes.

## What these controls will not do

They know nothing about stops, runs, drivers or any other Mesh resource, and they never fetch one. Hand them geometry and they draw it.

Mesh is a platform rather than a product. A control that fetched your runs for you would be shipping product, and that convenience belongs in documentation recipes you copy and own. Pinned by [`loc-mesh/design` ADR 0059](https://github.com/loc-mesh/design/blob/main/decisions/0059-sdk-map-the-map-control-customers-install.md) §4.

## Repository shape

One repository, one folder per platform, only the first of them real. The folders exist so that adding a platform is additive rather than a repository split with a rename — not because anything is planned for a platform with no consumer.

⚠️ **iOS will take its own repository.** Swift Package Manager resolves by repository URL with `Package.swift` at the root and versions off git tags, so an iOS package in a subdirectory would share one tag namespace with the browser one. ADR 0059 §2.

## Standards

Cross-repo conventions live in **[`loc-mesh/design`](https://github.com/loc-mesh/design)**. The ones that bind this repository most directly are [ADR 0059](https://github.com/loc-mesh/design/blob/main/decisions/0059-sdk-map-the-map-control-customers-install.md) (why it exists, what it may contain, how it publishes), [ADR 0056](https://github.com/loc-mesh/design/blob/main/decisions/0056-sdk-repo-prefix-family.md) (the `sdk-*` family), [`maps.md`](https://github.com/loc-mesh/design/blob/main/maps.md) and [`writing-standards.md`](https://github.com/loc-mesh/design/blob/main/writing-standards.md) — a public README is a product surface.

## Licence

MIT, and the dependency licences are audited in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The map data is OpenStreetMap under the Open Database Licence; the credit is a licence condition and these controls do not let you switch it off.
