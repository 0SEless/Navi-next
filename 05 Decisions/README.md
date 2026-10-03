# Architecture Decision Records — Index

Decision records for NAVI. Each ADR is a hard constraint, not guidance, once Accepted.

## Accepted

| ADR | Title | Date | Scope |
|-----|-------|------|-------|
| [006](ADR%20006%20-%20CampusDocument%20as%20Persistent%20Source%20of%20Truth.md) | CampusDocument as Persistent Source of Truth | 2026-07-15 | Editor persistence, interaction ownership, map-rendering ownership |
| [013](ADR%20013%20-%20Runtime%20Capability%20Architecture.md) | Runtime Capability Architecture | 2026-07-17 | Runtime public surface, capability pattern, application façade |
| [014](ADR%20014%20-%20Runtime%20Capability%20Lifecycle.md) | Runtime Capability Lifecycle | 2026-07-17 | Capability construction, sole ownership, disposal, replaceable implementations |
| [015](ADR%20015%20-%20M6%20Compatibility%20Baseline%20%26%20M7%20Composition%20Boundary.md) | M6 Compatibility Baseline & M7 Composition Boundary | 2026-07-17 | Freeze of M6 capability contracts; M7 classified as composition, not expansion |
| [016](ADR%20016%20-%20Geometry%20Engine%20Principles.md) | Geometry Engine Principles | 2026-07-25 | Canonical models, responsibilities, shared contract, interaction philosophy, engine independence |

## Reading Order

1. **ADR-006** establishes the editor's single source of truth — the upstream anchor of the
   whole pipeline.
2. **ADR-013 / ADR-014** define the runtime capability layer that M6 delivered: the façade
   (013) and its lifecycle/ownership rules (014).
3. **ADR-015** freezes the M6 surface as a compatibility baseline and classifies M7 as a new
   category (composition services) so future work builds on M6 without reshaping it.

## Capability Progression

```
M1  Domain Model
M2  Editor Model
M3  Graph Compiler
M4  Publisher
M5  Runtime Loader
M6  Runtime Capability Layer      ← frozen baseline (ADR-015)
M7  Composition Layer             ← composition services, not new low-level primitives
M8+ Application Experiences
```

## Milestone Status

| Phase | Owns                 | Status    |
|-------|----------------------|-----------|
| M1    | Domain model         | ✅         |
| M2    | Studio/editor model  | ✅         |
| M3    | Compilation          | ✅         |
| M4    | Package publishing   | ✅         |
| M5    | Runtime loading      | ✅         |
| M6    | Runtime vocabulary   | ✅ Frozen (ADR-015) |
| M7.0  | Composition model    | 📋 Spec+Plan defined (see `spec/M7.0-COMPOSITION-LAYER.md`, `plan/M7.0-PLAN.md`) |
| M7.1+ | Workflow composition | Next (only after M7.0 accepted) |

**Discipline rule:** M7.0 is architectural and precedes any concrete composition service
(VisitorJourneyService, AccessibilityNavigationService, CampusTourService). M7.1+ may begin
only after the composition model is accepted and a reference service proves it.

**Composition invariants (from M7.0 SPEC):**
- M7.0 defines the *rules of the composition layer* before any feature enters it — the same
  role ADR-013 played for capabilities. This prevents the first production service from
  accidentally becoming the architecture.
- Composition services **derive workflows, never new facts** (orchestration only).
- Composition **owns intent, not execution**: it emits *what should happen next* and never
  calls viewer/map/geolocation/UI APIs. Execution belongs to the application layer — the
  composition-layer analogue of M6's viewer-agnostic rule.
