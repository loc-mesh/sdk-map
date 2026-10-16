# Android — reserved, not built

Nothing here yet. The folder exists so that adding a native Android map control
is additive rather than a repository split with a rename.

When it is built it publishes to Maven Central as `com.locate2u:mesh-map`, and
it answers the same questions the web control answers in
[`../web`](../web): discovery, credentials and token refresh, themes,
attribution, and saying *why* when a map does not draw.

⚠️ **iOS does not belong here.** Swift Package Manager resolves by repository
URL with `Package.swift` at the repository root and versions off git tags, so an
iOS package in a subdirectory would share one tag namespace with the web one.
It takes its own repository, `sdk-map-ios`. See `loc-mesh/design` ADR 0059 §2.
