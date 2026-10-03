# ADR 006 — CampusDocument as Persistent Source of Truth

**Status:** Accepted
**Date:** 2026-07-15
**Scope:** NAVI editor persistence, interaction ownership, and map-rendering ownership.

## Context
P1.2 (Infrastructure Migration) inverts the legacy persistence model and removes the
last three legacy seams (Persistence, InteractionController, Canvas node selection).
During Seam 2 (InteractionController → pure router) a set of ownership invariants were
derived to keep every responsibility owned by exactly one module. This ADR records them.

## Decision
The editor obeys the following invariants. Each is a hard constraint, not guidance.

### Persistent Data Rule
The persisted/round-tripped authoring model is **CampusDocument** only. All other
runtime structures (NavigationGraph, GraphAdapter output, DrawingSession, PreviewState,
studio store, legacy graph stores) are reconstructible from a CampusDocument and must
never be persisted directly.

### Invariant S0
There is exactly **one mutable authoring model**: `CampusDocument`. The NavigationGraph
is a derived view; the editor mutates the document (via commands/dispatcher), and the
graph is regenerated from it.

### Interaction Ownership Rule
Every editor interaction is owned by **exactly one tool** (via `ToolRegistry`). The
`InteractionController` is a **router only**: it maps pointer/keyboard events to the
active tool and never implements interaction behavior itself.

### Road Authoring Rule
`Road` is the only authored path entity. Compiled traces and route edges are
**compiler output** and are never user-editable. Capability gaps G1 (compiled-trace
selection) and G7 (route editing) are therefore planned *removals*, not missing tools.

### Tool Activation Rule
`ToolRegistry.activate()` is the **only** mechanism that changes the active tool.
UI components (e.g. `ComponentPalette`) delegate to it and must not maintain a parallel
activation path (`setTool`).

### Legacy Reachability Rule
Legacy code may remain temporarily but must be **unreachable** from production UI.
*Unreachable = migration debt; reachable = architectural drift.* Before deleting legacy
code, prove reachability (grep `setTool(` / `legacySelectNode` / `legacySelectTrace`
→ usage → tests → browser → coverage). Deletion target is the unreachable block only;
still-reachable seams (e.g. Seam 3 `select-tool.ts` bridges) must stay until migrated.

### Rendering Single-Writer Rule
Each map source has **exactly one writer**. Tools **own preview state** and publish it
via `ToolContext.publishPreview`; the corresponding overlay (`DrawingOverlay` for
`SRC.DRAWING`) is the **sole renderer** and the only component allowed to call
`map.getSource(...).setData(...)`. Tools must never write to the map directly — that
recreates a per-tool `MapRenderer` (duplicated GeoJSON conversion, styling, and
multiple writers).

```
Pointer → InteractionController (router) → ToolRegistry → Tool (owns preview state)
        → PreviewState (studio store) → DrawingOverlay (sole writer) → SRC.DRAWING
```

This mirrors the established `CampusDocument → EntityRenderer` and
`NavigationGraph → NavigationGraphRenderer` pattern: **state producers and renderers
are separate, with a single rendering owner per layer.**

### Rendering Single-Writer Gate
`DrawingOverlay` is the **only** production component that writes to `SRC.DRAWING`.
No other reachable code may call `map.getSource(SRC.DRAWING).setData(...)`. This is
enforced by a runnable gate: `scripts/check-single-writer.mjs` (grep for
`SRC.DRAWING` + `setData` outside `DrawingOverlay`, excluding dead `*.legacy.*`).
Vertex-drag and building-drag previews publish to `previewFeatures` (studio store)
and are rendered by `DrawingOverlay` — they do NOT write to the map directly.
The committed `SRC.BUILDINGS` layer is owned solely by the `EntityRenderer`; the
controller no longer live-edits it during a building drag.

## Consequences
- `InteractionController.updateDrawPreview` has been removed (G6). Drawing preview is
  owned by the draw/place tools and rendered solely by `DrawingOverlay`.
- G6 is **fully complete**: vertex-drag and building-drag previews also route through
  `PreviewState` → `DrawingOverlay`; the single-writer gate passes.
- `ComponentPalette` delegates to `toolRegistry.activate` (G9).
- Legacy `switch(tool)` block in `InteractionController` is unreachable and scheduled
  for deletion after the remaining gaps (G2/G4/G6/G10) and Seam 3 are closed.

## Related
- `plan/P1.2-seam2-capability-matrix.md` — capability audit and gap tracking.
- `progress/PROGRESS.md` — per-gap execution log.
