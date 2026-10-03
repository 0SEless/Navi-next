# M2.4 — Selection Integration Design

**Status**: Approved (v1)
**Date**: 2026-07-10
**Dependencies**: M2.1 (SelectionManager + EntityId types), M2.2 (Explorer), M2.3 (Inspector)

---

## What

Complete the selection integration triangle: **click → select → inspect**. Ensure that selecting an entity in any panel (Explorer, Canvas) visually highlights it in all panels and opens the Inspector. Document the architectural invariant that `SelectionManager` is the authoritative selection model.

### Before M2.4

```
Explorer click → SelectionManager.select()
    ↓
  Explorer: ✅ highlights
  Canvas:   ❌ map.setFeatureState not triggered
  Inspector:✅ shows entity (via EventBus)

Canvas click → useStudioStore.setState({selectedNodeId})
    ↓
  SelectionBridge → SelectionManager.select()
    ↓
  Explorer: ✅ highlights (via useSelection)
  Canvas:   ✅ highlights (inline in click handler, but only there)
  Inspector:✅ shows entity (via EventBus)
```

The problem: Canvas highlighting only updates within the canvas click handler. If selection originates from Explorer, the canvas never re-highlights. The selection architecture is functionally present but visually incomplete.

### After M2.4

```
Explorer click:
  ↓ SelectionOrigin.Explorer
SelectionManager.select()
  ↓
  Explorer: ✅ highlights
  Canvas:   ✅ map.setFeatureState via useStudioStore.selectedNodeId effect
  Inspector:✅ shows entity via useSelection()
  Camera:   ✅ flyTo() (origin-gated)

Canvas click:
  ↓ SelectionOrigin.Canvas (via SelectionBridge)
SelectionManager.select()
  ↓
  Explorer: ✅ highlights
  Canvas:   ✅ highlights
  Inspector:✅ shows entity
  Camera:   ↛ no fly
```

---

## Success Criteria

1. **Canvas highlights respond to Explorer selection** — selecting a building/room in Explorer triggers `map.setFeatureState({selected: true})` on the canvas
2. **Explorer → camera fly** — selecting an entity in Explorer flies the canvas to that entity's position (origin-gated: only Explorer, not Canvas/Inspector)
3. **PropertiesPanel uses `useSelection()`** — the Inspector panel consumes selection through the React hook (like ExplorerPanel), not via raw service access
4. **String literals replaced** — `'explorer'` → `SelectionOrigin.Explorer` in ExplorerItem; no dead enum values introduced
5. **Both selection flows tested** — integration tests prove Explorer→SelectionManager→Canvas+Inspector and Canvas→SelectionBridge→SelectionManager→Explorer+Inspector
6. **Selection ownership documented** — `SelectionManager` is the authoritative model; `useStudioStore.selectedNodeId` is a temporary compatibility projection

## Known Pitfalls

- Canvas feature-state is reset by `setData()` calls — highlight must be restored after every data refresh
- Canvas click handler already manages its own feature-state via `lastSelectedNodeRef` — the new effect must coexist without double-setting or flickering
- `map.flyTo` requires position data — entities without geographic position (some rooms, some corridors) should no-op gracefully
- `useSelection()` must be called inside `<EditorProvider>` context — PropertiesPanel is already inside `<EditorBridge>` so this is fine

---

## Verification

All 6 success criteria met on 2026-07-10 with 11 integration tests passing:

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Canvas highlights respond to Explorer selection | ✅ | `StudioCanvas.tsx` — `useEffect` watches `selectedNode` via Zustand, calls `map.setFeatureState()` on change; tested in T1 |
| 2 | Explorer → camera fly (origin-gated) | ✅ | Already functional — Direction A handler sets `activeBuildingId` → existing fly-to in StudioCanvas; Canvas origin suppressed by `syncing` guard; comment added at Direction A handler |
| 3 | PropertiesPanel uses `useSelection()` | ✅ | `PropertiesPanel.tsx` — replaced `services.get('selection')` + EventBus with `useSelection()` hook |
| 4 | String literals replaced | ✅ | `ExplorerItem.tsx` — `'explorer'` → `SelectionOrigin.Explorer`; `Inspector` removed from `SelectionOrigin` enum |
| 5 | Both selection flows tested | ✅ | `SelectionIntegration.test.tsx` — 11 tests covering Direction A, Direction B, PropertiesPanel reactions, full integration |
| 6 | Selection ownership documented | ✅ | `EditorBridge.tsx` — module-level JSDoc block documents `SelectionManager` invariant; origin-gating rationale documented inline |

### Files changed

- `src/components/studio/StudioCanvas.tsx` — new `useEffect` for highlight sync (T1)
- `src/components/studio/EditorBridge.tsx` — origin-gating comment, selection ownership JSDoc (T2/T6)
- `packages/editor/src/panels/properties/PropertiesPanel.tsx` — refactored to `useSelection()` (T3)
- `packages/editor/src/context/entity-id.ts` — `Inspector` removed from `SelectionOrigin` (T4)
- `src/components/studio/ExplorerItem.tsx` — uses `SelectionOrigin.Explorer` (T4)
- `packages/editor/src/context/entity-id.test.ts` — updated for removed `Inspector` value (T4)
- `packages/editor/src/selection.test.ts` — two tests updated from `.Inspector` to `.Explorer` (T4)
- `src/components/studio/__tests__/SelectionIntegration.test.tsx` — new integration tests (T5)
