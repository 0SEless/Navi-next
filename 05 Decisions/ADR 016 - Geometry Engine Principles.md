# ADR 016 — Geometry Engine Principles

**Status:** Accepted
**Date:** 2026-07-25
**Scope:** All geometry engines in NAVI Studio — Path, Polygon, Point, Parametric, Transform.

## Context

NAVI Studio has evolved from a collection of editor features (hallway tool, building tool, staircase tool) into a system of geometry engines (Linear Geometry Engine, Parametric Engine, Diagnostic Engine). Each engine was built pragmatically, and the patterns that work well (canonical data, session model, overlay architecture) emerged organically.

With the Polygon Engine as the next engine, the architecture has reached a point where the shared principles need to be explicit. Without a written constitution, future engines will gradually diverge — one will embed rendering, another will leak persistence, a third will couple to UI. The cost of divergence grows with each engine.

This ADR codifies the invariants that every geometry engine must obey.

## Decision

### 1. Purpose

Geometry editing is a first-class subsystem of NAVI Studio. Geometry engines provide reusable editing, analysis, and transformation capabilities independent of domain entities such as rooms, hallways, buildings, or roads. A geometry engine knows *what* it edits (paths, polygons, points, components) and never *what* that represents (hallway, room, entrance, stair).

### 2. Canonical Representation

Every engine owns exactly one canonical model.

| Engine | Canonical Model |
|--------|----------------|
| PathEngine | `EditablePath` |
| PolygonEngine | `EditablePolygon` |
| PointEngine | `EditablePoint` |
| ParametricEngine | `ParametricComponent` |
| TransformEngine | (shared operations, no single model) |

Renderers consume canonical data. Canonical data never imports renderers. The canonical model lives in the engine's own types, not in `@navi/core` or any shared package.

### 3. Engine Responsibilities

Every geometry engine **may**:

- Create and destroy instances of its canonical model
- Edit instances (vertex insertion/deletion, property mutation, etc.)
- Transform instances (move, rotate, scale, mirror — or delegate to TransformEngine)
- Constrain edits (snapping, bounds, min/max values)
- Analyze local geometry (length, area, winding, self-intersection)
- Expose interaction state (hover, drag, selection candidate)

Every geometry engine **must not**:

- Render to canvas or map
- Persist data (document save/load)
- Compile to navigation artifacts
- Know document semantics (room, building, hallway, road)
- Know UI (panels, inspectors, toolbars, React components outside its own overlay)
- Import from `@navi/core` entity types (Room, Building, etc.)

### 4. Shared Contract

Every engine exposes the same conceptual pipeline:

```
Canonical Model
       ↓
    Session
       ↓
     Hook
       ↓
   Overlay
       ↓
  Renderer(s)
```

- **Canonical Model**: The pure data type the engine edits (e.g. `EditablePath`, `EditablePolygon`).
- **Session**: Stateful wrapper holding the active editing target, undo stack, and interaction mode.
- **Hook**: React hook bridging session to component lifecycle (`useEditablePathEditor`, `useEditablePolygonEditor`).
- **Overlay**: Canvas-level visual feedback during editing (vertex handles, hover highlights, preview geometry).
- **Renderer**: Map/Canvas component that renders the canonical model after editing commits.

### 5. Interaction Philosophy

All geometry editing happens on the canvas. Inspectors edit metadata. Canvas edits geometry. This is a fundamental design principle, not a convention.

- Move, insert, delete, resize — always on the canvas.
- Name, color, category, type — always in the Inspector panel.
- A tool that mixes canvas editing and metadata editing in the same interaction is violating this principle.

### 6. Engine Independence

Every engine is independent of every other engine. They share infrastructure (TypeScript types, React, MapLibre) but never import each other's internals.

- **Diagnostics** are external. The Diagnostic Engine consumes canonical data — it never lives inside a geometry engine.
- **Selection** is external. The Selection Engine manages hit testing and focus — geometry engines produce hover/drag state but don't own selection.
- **Transforms** are shared. The Transform Engine provides move/rotate/scale that any engine can opt into.
- **Compilation** is external. The Graph Compiler and Component Compiler consume canonical data from multiple engines.
- **Publishing** is external. The Publisher serializes document state, not engine state.

### 7. Renderers

An engine may provide a generic renderer (e.g. `PolygonRenderer`) that renders its canonical model with configurable style. Domain-specific renderers (`RoomRenderer`, `BuildingRenderer`, `BoundaryRenderer`) compose the generic renderer and supply domain-specific styling.

Domain renderers live outside the engine, in the application layer.

### 8. Future Engines

The architecture plans for these geometry engines:

- **PathEngine** — Linear geometry (hallways, roads, routes, traces). ✅ Exists as LGE.
- **PolygonEngine** — Closed shapes (rooms, footprints, boundaries, zones). Next.
- **PointEngine** — Point features (entrances, QR markers, panoramas, POIs, anchors).
- **ParametricEngine** — Parameter-driven components (stairs, elevators, ramps). ✅ Exists.
- **TransformEngine** — Shared move/rotate/scale/snap/mirror/duplicate for all canonical models.

## Consequences

### Positive

- Every new engine follows a known pattern, reducing design overhead.
- The renderer/engine split prevents rendering concerns from leaking into editing logic.
- The canonical model rule keeps data types stable across the project.
- New contributors have a single document to answer "how do geometry engines work?"
- Diagnostic Engine, Selection Engine, and Transform Engine remain independent and reusable.
- Future engine authors can point to ADR-016 when design discussions arise, rather than re-debating fundamentals.

### Negative

- Some engines may need slight adaptation of the pattern (TransformEngine has no canonical model of its own).
- The strict separation can feel rigid for very small features — but the consistency benefit outweighs this.
- Existing code (LGE, ParametricEngine) may not fully comply yet and will need gradual alignment.

## Alternatives Considered

| Alternative | Pros | Cons | Reason Rejected |
|---|---|---|---|
| No ADR, keep evolving organically | Zero up-front cost | Engines drift; each new one reinvents patterns | Architecture needs stability at this scale |
| Per-engine design docs only | Captures specifics | No shared contract; engines diverge | A constitution is needed above per-engine specs |
| Monorepo of engine packages | Strong isolation | Premature; increases build complexity | YAGNI — share via `src/` until extraction is justified |

## Related

- Referenced by: `spec/RC-POLYGON-ENGINE.md` (first engine built under this ADR)
- Referenced by: `spec/RC-PARAMETRIC-ENGINE.md` (existing engine — alignment planned)
- Supersedes: Implicit engine conventions from LGE and Parametric Engine implementations
