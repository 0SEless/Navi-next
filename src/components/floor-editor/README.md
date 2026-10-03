# Floor Editor — Component Status

## Active (wired into production)

| File | Role |
|------|------|
| `FloorEditor.tsx` | Main editor component — deployed via Vercel |
| `FloorEditorCanvas.tsx` | MapLibre canvas with raw event handlers for polygon/path editing |
| `FloorPlanAlignment.tsx` | Floor plan image calibration |
| `FloorOutliner.tsx` | Floor hierarchy tree |
| `HallwayRenderer.tsx` | Hallway MapLibre layers |
| `RoadRenderer.tsx` | Road MapLibre layers |
| `LinearGeometryOverlay.tsx` | Path editing overlay |
| `LinearGeometryRenderer.tsx` | Path GeoJSON rendering |
| `useFloorDrawing.ts` | Drawing state machine |
| `useEditablePathEditor.ts` | Path editing hook |
| `draw-reducer.ts` | Drawing state reducer |
| `ComponentProperties.tsx` | Parametric component property editor |
| `ParametricEngine.ts` | Stair/elevator geometry engine |
| `transform-helpers.ts` | Coordinate transform utilities |
| `ErrorBoundary.tsx` | Error boundary wrapper |
| `DebugConsoleCapture.tsx` | Development debug capture |
| `adapters/` | Floor and tool adapters |

## Experimental (not integrated — retained for post-thesis)

These files form the **PolygonEngine cluster**: a reusable geometry kernel with 70 tests. It was built as a clean replacement for the raw MapLibre polygon editing in `FloorEditorCanvas.tsx` (lines 516–765) but is **not currently wired in**.

| File | Role | Tests |
|------|------|-------|
| `PolygonEngine.ts` | Polygon geometry kernel (create, clone, edges, area, insertVertex, deleteVertex, etc.) | 53 |
| `PolygonRenderer.tsx` | Configurable SVG polygon renderer | 2 |
| `useEditablePolygonEditor.ts` | React hook with undo/redo session for polygon editing | 10 |
| `PolygonOverlay.tsx` | MapLibre overlay with vertex handles, edge midpoints, hover/drag | — |
| `polygon-constraints.ts` | Validation utilities (min edge, min area, deduplicate) | 5 |

**Decision:** Do not integrate before August 10 thesis deadline. Re-evaluate after thesis if the current raw MapLibre handlers limit future development.

See `05 Decisions/ADR 020 - Cancel Studio Rebuild.md` for context.
