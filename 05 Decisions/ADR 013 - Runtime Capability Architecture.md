# ADR 013 — Runtime Capability Architecture

**Status:** Accepted
**Date:** 2026-07-17
**Scope:** NAVI runtime public surface, capability pattern, and the application-facing façade.

## Context

Before M6 the runtime was a collection of engines (`SearchEngine`, `RoutingEngine`,
`PositionEngine`, `SearchAPI`, `PositionAPI`) that applications drove directly. Each exposed
its own idiosyncratic method surface and some held mutable state (`PositionAPI.updateGps()`).
Applications had to understand graphs, search indexes, GPS resolvers, and panorama files to
use the runtime.

M6 replaced that with a **capability layer**: a façade of five stateless services, each
answering one domain question, each backed by a *published artifact* rather than by editor
data. By the time M6.5b landed, the architecture had fully realized this shape and was
verified by 1056 passing tests. This ADR records the design that the codebase actually
became — written after implementation, while the rationale is concrete rather than speculative.

## Decision

### The Capability Façade

`RuntimeEngine` exposes exactly five capabilities. Applications ask questions; they never
touch engines, indexes, or files.

```ts
engine.navigation.findRoute(from, to)   // "How do I get there?"
engine.search.search("Library")         // "What exists?"
engine.buildings.get(id)                // "Tell me about this place."
engine.location.resolve(position)       // "Where am I?"
engine.panoramas.getHotspots(id)        // "What does this look like?"
```

### The Capability Pattern

Every capability obeys the same rules. Each is a hard constraint, not guidance.

- **Backed by published artifacts, not editor data.** Each capability is constructed from a
  `LoadedPackage` and reads only the artifact it owns:
  - Navigation → `graph`
  - Search → `searchIndex`
  - Buildings → `buildingIndex`
  - Location → `graph` + `buildingIndex`
  - Panorama → `panoramaIndex`
- **Stateless.** No capability stores GPS history, current position, or session state.
  Every method takes its inputs as arguments and returns results deterministically.
- **Read-only projection.** Capabilities never mutate `LoadedPackage`; they project
  published data into immutable domain DTOs (`readonly`, defined alongside the service).
- **Deterministic.** Same `LoadedPackage` + same arguments → same result.
- **Single responsibility.** A capability answers one question category; it never routes
  (Location), searches (Location/Building), or renders (Panorama).
- **Viewer-agnostic.** `PanoramaService` exposes panorama metadata and hotspot relationships
  only. It imports no viewer library (Pannellum, Marzipano), no DOM, no camera math. The
  application decides what a hotspot click means.

### Consistent Pipeline

Every capability follows the identical data path, which is what gives the architecture its
durability:

```
Editor
    ↓
Compiler
    ↓
Artifact
    ↓
Publisher
    ↓
Package
    ↓
Loader
    ↓
LoadedPackage
    ↓
Runtime Capability
```

### Lifecycle Ownership

`RuntimeEngine` is the **sole owner** of capability lifecycle (see ADR-014). Capabilities are
constructed inside the engine and are not instantiated independently by applications.

## Consequences

- Applications no longer depend on runtime internals (graph shape, index layouts, GPS
  resolvers, panorama file format). The runtime has its own vocabulary.
- Adding a capability is mechanical: extend the artifact pipeline (M6.5a showed this is
  possible without breaking frozen layers), then add a stateless service.
- The five capabilities are the stable public surface; M7 builds *composition* on top of them
  without reshaping them (see ADR-015).

## Related

- ADR-014 — Runtime Capability Lifecycle (ownership, construction, disposal).
- ADR-015 — M6 Compatibility Baseline & M7 Composition Boundary.
- `spec/M6.1`–`spec/M6.5b` — individual capability specs.
- `packages/runtime/src/engine/` — capability implementations.
