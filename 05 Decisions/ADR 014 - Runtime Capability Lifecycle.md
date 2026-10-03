# ADR 014 — Runtime Capability Lifecycle

**Status:** Accepted
**Date:** 2026-07-17
**Scope:** How runtime capabilities are constructed, owned, and disposed; what may replace them.

## Context

M6 introduced five capabilities behind `RuntimeEngine`. Without an explicit lifecycle
policy, capabilities could be instantiated ad hoc by applications, constructed from partial
state, or hold references that outlive the engine — recreating the stateful-runtime problems
M6 was designed to remove. This ADR fixes the lifecycle contract. Written after M6 was fully
implemented and verified, so it documents the realized behavior.

## Decision

### Sole Ownership

`RuntimeEngine` is the **sole owner of capability lifecycle.** Capabilities are constructed
inside the engine constructor from the single `LoadedPackage`, and are not instantiated
independently by applications.

```ts
class RuntimeEngine {
  readonly data: DataAPI
  readonly search: SearchService
  readonly navigation: NavigationService
  readonly buildings: BuildingService
  readonly location: LocationService
  readonly panoramas: PanoramaService

  constructor(pkg: LoadedPackage) { /* all capabilities constructed here */ }
}
```

### Construction

- All capabilities receive the **same** `LoadedPackage` instance at construction time.
- A capability must tolerate a package that omits its artifact (e.g. `panoramaIndex?` is
  optional). Absence is handled per-method, never by throwing in the constructor.
- Capabilities are immutable once constructed: they hold only read-only references to
  published data and derived lookups (e.g. a `Set` of ids built once in the constructor).

### Replaceable Implementations

A capability's *interface* is part of the stable public surface (ADR-015); its *implementation*
may be replaced or optimized without notice, provided it preserves the interface contract and
the invariants in ADR-013 (stateless, read-only, deterministic, artifact-backed). The engine
is the only place that wires a concrete implementation to its public property.

### Disposal

Capabilities hold no disposable resources (no open handles, no subscriptions, no listeners).
There is no `dispose()` method. When the `RuntimeEngine` is discarded, its capabilities become
unreachable and are collected normally. Viewer/UI resources (map layers, panorama viewers) are
owned by the application, never by a capability.

### Prohibited Patterns

- Applications constructing `new SearchService(...)` / `new PanoramaService(...)` directly.
- Capabilities storing mutable session state or subscribing to external events.
- Capabilities importing application/viewer packages.
- Two capability instances for the same engine built from different package snapshots.

## Consequences

- The capability set is a closed, engine-owned vocabulary. New behavior enters through
  composition (ADR-015), not by adding stateful engines.
- Lifecycle bugs (stale capability over a reloaded package, leaked listeners) are structurally
  prevented.

## Related

- ADR-013 — Runtime Capability Architecture (the capability pattern and public surface).
- ADR-015 — M6 Compatibility Baseline & M7 Composition Boundary.
- `packages/runtime/src/engine/runtime-engine.ts` — single construction site.
