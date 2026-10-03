# M2.4 Selection Integration — Execution Plan

**Status**: Draft
**Date**: 2026-07-10
**Spec**: `docs/superpowers/specs/2026-07-10-m24-selection-integration-design.md`

---

## Tasks

### T1 — Canvas highlight sync

**What**: Add a `useEffect` in `StudioCanvas.tsx` that watches `useStudioStore.selectedNodeId` and applies `map.setFeatureState({selected: true/false})` to the previously-selected and newly-selected nodes.

**Files to touch**:
- `src/components/studio/StudioCanvas.tsx` — add effect after existing data-sync effect

**Key behaviors**:
- Deselect previous node via `map.setFeatureState(previousId, {selected: false})`
- Select new node via `map.setFeatureState(newId, {selected: true})`
- Must coexist with existing inline feature-state in the click handler (they manipulate the same NODES/NODES_CONNECTION sources)
- Must restore after `setData()` refreshes (which clear feature-state) — this effect will naturally do so since it runs when selectedNodeId changes
- Only fire when `map` is ready (`readyRef.current`)

**Acceptance**: Selecting a building in Explorer causes canvas node to highlight.

---

### T2 — Explorer → fly camera

**What**: When `ExplorerItem` emits a select with `SelectionOrigin.Explorer`, fly the map camera to the selected entity.

**Approach**:
- Add an `onFlyTo` callback to `ExplorerProps` → `ExplorerPanel` implements it
- `ExplorerPanel` has access to `findEntityById(document, entityId)` which returns the entity + path
- For buildings, use footprint bounds (already have `map.fitBounds` logic in `StudioCanvas`)
- For floors, delegate to parent building bounds
- For rooms/hallways/etc, use the parent building bounds
- For roads, use polyline bounds
- For panoramas/QRs, use their position
- No-op if no position/bounds data available

**Integration**: Since `StudioCanvas` and `ExplorerPanel` are siblings, use a shared callback through `EditorBridge` or a Zustand store action (`useStudioStore.getState().flyTo`).

**Simplest path**: Add `selectedBuildingId` → `useEffect` in `StudioCanvas` watches `activeBuildingId` (already exists at line 363-375). Route Explorer selection → `useStudioStore.setState({activeBuildingId})` — the existing fly-to effect picks it up. For non-building entities, extend the effect or add a parallel one.

**Files to touch**:
- `src/components/studio/ExplorerPanel.tsx` — add fly-to dispatch on Explorer-origin select
- `src/components/studio/StudioCanvas.tsx` — extend existing fly-to effect or add simpler position-based fly

**Acceptance**: Clicking a building in Explorer flies the map to it. Clicking a canvas node does NOT fly. Clicking a floor/room in Explorer shows the parent building.

---

### T3 — PropertiesPanel → use `useSelection()`

**What**: Replace raw `services.get('selection')` + `eventBus.on('selection.changed')` with the `useSelection()` hook.

**Changes**:
- Remove `selectedId` local state (`useState<string | null>`)
- Remove `syncSelection` callback
- Remove `useEffect(() => { eventBus.on('selection.changed', ...) })`
- Call `useSelection()` and derive `selectedId` from `selection.lastSelected?.id`
- Remove `eventBus` import if no longer needed
- Keep `version = useDocumentVersion()` for re-render on document changes

**Files to touch**:
- `packages/editor/src/panels/properties/PropertiesPanel.tsx`

**Acceptance**: PropertiesPanel renders the same with cleaner code. Tests pass.

---

### T4 — Replace string literals with `SelectionOrigin`

**What**: In `ExplorerItem.tsx`, replace `'explorer' as SelectionOrigin` with `SelectionOrigin.Explorer`.

**Also**:
- Remove `SelectionOrigin.Inspector` from `entity-id.ts` (per scope decision — no speculative enum values)
- Keep `SelectionOrigin.Keyboard` and `SelectionOrigin.Programmatic` as they have established usage

**Files to touch**:
- `src/components/studio/ExplorerItem.tsx` — string → enum
- `packages/editor/src/context/entity-id.ts` — remove `Inspector` from `SelectionOrigin`
- Any file referencing `SelectionOrigin.Inspector` (search for it)

**Acceptance**: `SelectionOrigin.Inspector` does not exist. Explorer uses `SelectionOrigin.Explorer`. All tests pass.

---

### T5 — Integration tests

**Flow 1: Explorer → SelectionManager → Canvas + Inspector**
1. Mount `<EditorBridge>` with a mock CampusDocument
2. Simulate Explorer select
3. Verify: `SelectionManager.lastSelectedId` matches
4. Verify: Inspector renders properties (mock with `data-testid`)
5. Verify: canvas highlight action would fire (mock `map.setFeatureState` or verify bridge output)

**Flow 2: Canvas → SelectionBridge → SelectionManager → Explorer + Inspector**
1. Mount `<EditorBridge>` with mock document
2. Simulate canvas selection via `useStudioStore.setState({selectedNodeId})`
3. Verify: `SelectionManager.lastSelectedId` matches (selection propagated through bridge)
4. Verify: Explorer receives updated selection (via `useSelection()`)
5. Verify: Inspector renders properties

**Files to create**:
- `src/components/studio/__tests__/SelectionIntegration.test.tsx`

**Acceptance**: 6+ tests covering both flows.

---

### T6 — Document selection ownership invariant

**What**: Add a doc comment in `src/components/studio/EditorBridge.tsx` (near the Direction A/B bridge code) and a brief architectural note confirming:

> `SelectionManager` is the authoritative selection model. `useStudioStore.selectedNodeId` exists only as a legacy compatibility projection until `StudioCanvas` is migrated from MapLibre direct API to the editor framework canvas adapter.

**Files to touch**:
- `src/components/studio/EditorBridge.tsx` — add doc comment block above Direction A/B wiring
- `docs/superpowers/specs/2026-07-10-m24-selection-integration-design.md` — add note to `## Design Invariants` section

**Acceptance**: Clear ownership statement present in code + spec.
