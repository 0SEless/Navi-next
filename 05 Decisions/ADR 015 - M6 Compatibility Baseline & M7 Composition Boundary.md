# ADR 015 — M6 Compatibility Baseline & M7 Composition Boundary

**Status:** Accepted
**Date:** 2026-07-17
**Scope:** Stability guarantee for the M6 capability surface; classification of M7 as a new
category (composition, not expansion).

## Context

M6 (M6.1–M6.5b) delivered the first architecturally complete runtime: five capabilities
behind `RuntimeEngine`, each backed by a published artifact and exposed as a stateless,
read-only, deterministic façade (ADR-013/014). This is a natural pause point. Before any M7
work begins, the M6 public surface must be frozen as a **compatibility baseline**, and M7 must
be explicitly classified as a *different category* of work so it does not casually reshape M6.

## Decision

### M6 Compatibility Baseline

The following properties of `RuntimeEngine` constitute the stable public surface. They are
considered **stable and backward compatible**:

```ts
engine.navigation   // NavigationService
engine.search       // SearchService
engine.buildings    // BuildingService
engine.location     // LocationService
engine.panoramas    // PanoramaService
```

**Compatibility statement:** *M7 may add capabilities and composition services, but the
existing M6 capability contracts are stable. Changes to method signatures, return DTO shapes,
or removed capabilities of the five baseline services require an ADR and a deprecation window.*

### M7 Is Composition, Not Expansion

M7 introduces a **new category** — *composition services* — layered above the capabilities.
Composition services own **workflow**, not **data**. They orchestrate existing capabilities
and must not introduce new low-level runtime primitives or re-expose artifact internals.

```
Runtime Capabilities (M6, frozen baseline)
        │
        ▼
Composition Services (M7)
```

Examples of valid M7 composition services:

```ts
VisitorJourneyService    // uses Location, Search, Buildings, Navigation, Panorama
AccessibilityNavigationService // uses Navigation, Buildings, Panorama
CampusTourService        // uses Search, Panorama, Navigation
```

Each composition service is itself constructed from `LoadedPackage` (or receives the
`RuntimeEngine`) and delegates every data question to a capability. It adds sequencing,
state-machine workflow, and cross-capability coordination — nothing below the façade.

### Classification Rule

- **Capability (M6, frozen):** answers one domain question from one artifact; stateless;
  read-only projection; viewer-agnostic.
- **Composition service (M7+):** orchestrates two or more capabilities to fulfil a user
  journey; owns workflow/state-machine, not data; built only on the M6 façade.

If a proposed M7 service would need to read an artifact directly (bypassing a capability) or
add a new artifact-backed primitive, it is misclassified and must either become an M6-style
capability (with its own ADR + artifact pipeline extension) or be rejected.

## Consequences

- M6 has a hard semantic boundary: future work composes on top of it without reshaping it.
- The progression is now explicit:
  - M1–M5: Data pipeline (editor → compiler → artifact → publisher → package → loader)
  - M6: Runtime capability vocabulary (the façade)
  - M7: Capability composition (workflow services)
  - M8+: Application experiences built on that composition
- A regression that alters a baseline capability signature is detectable as an ADR-required
  change, not a silent edit.

### Composition Service Construction Rule

Each composition service receives the **entire** `RuntimeEngine`. This is intentional: a
composition service may need any combination of capabilities. Receiving the full engine avoids
a proliferation of narrow interfaces and keeps the composition constructor signature stable
as capability needs evolve. However, this privilege also carries responsibility — see
Addendum 2026-07-18.

## Addendum 2026-07-18: RuntimeEngine Design Constraint

**RuntimeEngine must remain a thin composition root and stable façade.** It has two
responsibilities that are compatible today but would diverge under pressure:

1. **Composition root** — constructs and wires the capability object graph.
2. **Public API surface** — exposes stable capabilities via properties.

### Rules

- `RuntimeEngine` should contain approximately zero logic — construction and property
  access only. Convenience methods (`engine.findBuilding(...)`, `engine.route(...)`) belong
  on the relevant capability, not the engine.
- Capabilities are added by adding a property, not by adding methods to the engine class.
- Composition services receive the full engine. If a composition service consistently uses
  fewer capabilities than it receives, that is an observation point, not a design defect.
- If the capability count grows materially beyond five (e.g. >10), consider extracting a
  `CapabilityRegistry` behind the same public properties to keep engine construction tidy
  without changing the application-facing contract.

### Metrics

| Metric | Healthy |
|---|---|
| Public `RuntimeEngine` methods | ~0 (constructor only) |
| Public capability properties | Grows slowly (5 → 8 → 10) |
| Logic inside `RuntimeEngine` | Near zero |

### Motivation

M7.0 proved the composition architecture works by separating knowledge (pipeline),
reasoning (capabilities), workflow (composition), and presentation (application).
`RuntimeEngine` sits at the center of that stack. If it accumulates behavior, the
separation erodes from the inside — not through an ADR, but through convenience.

### Interaction with Other Rules

- ADR-013 defines the capability contract (read-only, stateless, viewer-agnostic).
  An engine with logic would make it harder to test capabilities independently.
- ADR-014 defines the lifecycle. An engine that constructs capabilities must stay simple
  enough that lifecycle changes (initialization order, lazy loading) can be made without
  touching applications.
- M7's composition-service construction rule (above) gives each service full engine access.
  That only works if the engine stays boring; a complex engine would leak across
  composition boundaries.

## Related

- ADR-013 — Runtime Capability Architecture.
- ADR-014 — Runtime Capability Lifecycle.
- ADR-015 Addendum 2026-07-18 — RuntimeEngine Design Constraint (this section).
- `spec/M6.1`–`spec/M6.5b` — baseline capability contracts.
- `packages/runtime/src/engine/` — baseline capability implementations.
