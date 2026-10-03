# Legacy → New Architecture Migration Matrix

**Strategy:** Strangler Fig. The deployed app (`navi-next`) IS the V2 codebase; it runs with
legacy Zustand / `InteractionController` fallback paths still active. For each subsystem we
understand the legacy behavior, find the new-architecture equivalent, port it, verify, then
delete the legacy path.

**Hard rule:** every fix must use the new architecture (`CampusDocument`, `ToolRegistry`,
`CommandBus`, `Workflow`, `GraphAdapter`, `SelectionManager`). No legacy code is restored.

**Verification:** Tier 1 is backed by `packages/editor/src/tools/draw-room-tool.verify.test.ts`
(6 passing tests driving the real tools).

---

## Tier 1 — Critical correctness bugs  ✅ DONE

| ID | Subsystem | Legacy behavior | New implementation | Status | Evidence |
|----|-----------|-----------------|--------------------|--------|----------|
| T1.1 | Room drawing coordinates | `drawRoomTool` stored screen `{x,y}` → broke `room.create` | Stores world `{lat,lng}`, converts via `transformer.worldToBuildingLocal()` to `LocalCoord[]` | ✅ DONE | test: room produces local meters (~0–11m), not 100/200/300 screen px |
| T1.2 | Hallway drawing coordinates | `drawHallwayTool` stored screen `{x,y}` | Same fix as T1.1 | ✅ DONE | test: hallway produces local meters |
| T1.3 | Map click hit-test (select) | `entityAtEvent()` was a stub returning `null`; selection ran via legacy fallback | Real `map.queryRenderedFeatures` hit-test; building → `SelectionManager`, node/trace → legacy bridge, empty → clear | ✅ DONE | 4 tests: building/node/trace/empty routing |

**Wiring:** `InteractionController.tsx` now builds the `ToolContext` with `transformer`, `map`,
and `legacySelectNode` / `legacySelectTrace` bridges, and routes **all** clicks (including
`select`) to the registry tool.

---

## Tier 2 — Port remaining legacy drawing behaviors  ⬜ TODO

| ID | Subsystem | Legacy file(s) | New equivalent | Removable? |
|----|-----------|----------------|----------------|-----------|
| T2.1 | Building move / adjust | `InteractionController` `buildingDrag` (mousedown/move/up) | `building-adjust-tool.ts` (exists, registry) | yes |
| T2.2 | Vertex editing | `InteractionController` `dragVertexRef` + `findNearestVertex` | new vertex-edit tool / `building-adjust-tool` | yes |
| T2.3 | Route / trace drawing | `useStudioStore.tracePoints` + legacy `route` branch | new `draw-road` / route tool via CommandBus | yes |
| T2.4 | Building polygon drawing | `useStudioStore.drawPoints` + legacy `building`/`boundary` branch | `drawBuildingTool` (already correct) — port the polygon UX | yes |
| T2.5 | Pan tool | `pan-tool.ts` `onPointerDown` is a no-op | wire to map `dragPan` (already toggled in cursor effect) | yes |

---

## Tier 3 — Selection & camera unification  ⬜ TODO

| ID | Subsystem | Legacy file(s) | New equivalent | Removable? |
|----|-----------|----------------|----------------|-----------|
| T3.1 | Selection state store | `useStudioStore` (`selectedNodeId`, `selectedTraceId`, `selectedBuildingId`, `activeBuildingId`) | `SelectionManager` + `SelectionBridge` (Direction A/B) | after T3 complete |
| T3.2 | Camera fly-to on selection | `InteractionController` legacy select `flyTo` | `SelectionBridge` → `activeBuildingId` → `MapCanvas` flyTo | after T3 complete |
| T3.3 | Node selection representation | graph nodes have no `SelectionManager` type | add `node` to `EntitySelector` OR keep legacy bridge (current) | after decision |
| T3.4 | Trace/road selection representation | `selectedTraceId` (legacy only) | add `road` selector plumbing OR keep legacy bridge (current) | after decision |
| T3.5 | Dead legacy branch cleanup | `InteractionController.handleClick` `curTool === 'select'` block (now unreachable) | delete once T3.1–T3.4 land | yes |

---

## Tier 4 — Everything else  ⬜ TODO

| ID | Subsystem | Legacy file(s) | New equivalent | Removable? |
|----|-----------|----------------|----------------|-----------|
| T4.1 | Properties panel | `PropertiesPanel.tsx` (reads legacy stores) | bind to `SelectionManager` selectors | after port |
| T4.2 | Layers / Outliner | `LayerTree` / explorer | `explorer/adapter.ts` `EntitySelector` sync | after port |
| T4.3 | Save / Load | `graph-store.ts` `loadMapData` | `Workflow` + `GraphAdapter` (graph → `CampusDocument`) | after port |
| T4.4 | Undo / Redo | legacy history | `History` service + `CommandBus` inverse commands | after port |
| T4.5 | Mode switching (campus/building/floor) | `editingContext.mode` + `useStudioStore` | `EditingContext.mode` (already owns it) | after port |
| T4.6 | Toolbar activation | `StudioToolbar` `toolRegistry.activate(t)` (already routes all tools incl. select) | keep — already correct | n/a |
| T4.7 | Publish | `publish-service.ts` | `publish-service.ts` (new) — already wired | n/a |
| T4.8 | Coordinate transform | ad-hoc in legacy handlers | `CoordinateTransformer` (already used by T1 tools) | n/a |

---

## New-architecture key files

- `packages/editor/src/tools/` — `registry.ts`, `types.ts`, `select-tool.ts`, `draw-room-tool.ts`, `draw-hallway-tool.ts`, `draw-building-tool.ts`, `place-entrance-tool.ts`, `building-adjust-tool.ts`, `pan-tool.ts`
- `packages/editor/src/context/` — `create-editor-context.ts` (registers tools + buildings in transformer), `selection-bridge.ts`, `entity-id.ts` (`EntitySelector`)
- `packages/editor/src/selection.ts` — `SelectionManager`
- `packages/editor/src/commands/` — `room-handlers.ts`, `hallway-handlers.ts`, `building-handlers.ts`, `dispatcher.ts` (CommandBus)
- `packages/editor/src/services/` — `workflow.ts`, `publish-service.ts`, `editing-context.ts`, `viewport.ts`
- `packages/core/src/coordinates/transformer.ts` — `CoordinateTransformer.worldToBuildingLocal()`
- `src/components/studio/InteractionController.tsx` — hybrid event router (registry tool first, legacy fallback)
- `src/components/studio/EditorBridge.tsx` — `SelectionManager` ↔ legacy store sync

## Open decision (blocks T3.3 / T3.4)
Graph nodes and traces/roads have no `SelectionManager` representation. Options:
(a) add `node` / `road` to `EntitySelector` and plumb through PropertiesPanel, or
(b) keep the legacy bridge (`legacySelectNode` / `legacySelectTrace` in `ToolContext`) as the
permanent seam. Tier 1 chose (b) to avoid touching `EntitySelector` exhaustively.
