# M2.3: Inspector Migration — Implementation Plan (v2, adjusted)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the already-built `PropertiesPanel` into NAVI Studio's right panel, driven by `CampusDocument` + `SelectionManager` + `entity.update` command, replacing the legacy Zustand/graph-mutation inspector cluster as the active editor (legacy files relocated to `legacy/`, not deleted).

**Architecture:** The Inspector is the read/write projection of the selected entity. Data flows one way into `CampusDocument`:

```
CampusDocument ──version++──▶ useDocumentVersion() ──▶ PropertiesPanel + Explorer re-render
                                      ▲
SelectionManager ◀── SelectionBridge ◀── Canvas (legacy store)
```

The Inspector writes only via `entity.update`. `SelectionBridge` translates selection only. `CampusDocument` is created once per open map (invariant).

**Tech Stack:** React 19, TypeScript, `@navi/editor` (`EditorProvider`, `useEditor`, `SelectionManager`, `CommandDispatcher`, `SelectionBridge`, `useDocumentVersion`), `@navi/core` (`CampusDocument`).

## Global Constraints

- No direct imports of legacy Zustand stores (`useGraphStore`, `useStudioStore`, `useCampusMapStore`) in any new/migrated Inspector file — grep gate (only `EditorBridge`/`SelectionBridge` may bridge)
- `CampusDocument` is the only editable model; the Inspector writes only via `entity.update`
- No writes to `graph-store` from the Inspector (write-back deferred to Phase 4 Navigation Compiler)
- **Invariant:** `CampusDocument` created ONCE per bridge mount; never recreated on selection/edit/graph change
- **Single bridge:** `ExplorerPanel` + `PropertiesPanel` share one `EditorBridge`
- **SelectionBridge** bridges selection only — no document/command logic
- **Version-driven re-render:** `useDocumentVersion()` drives re-renders; no per-component `entity.updated` subscriptions for rendering
- Subscriptions cleaned up in `useEffect` return (no leaks / loops)
- Public API freeze: `<PropertiesPanel />`, `entity.update` payload, `useDocumentVersion`, `SelectionBridge` API

## Decision (locked)

> **Mount + selection, defer write-back.** Inspector edits `CampusDocument` (with undo); legacy canvas keeps rendering from `graph-store` unchanged. Canvas reflecting Inspector edits is deferred to the Navigation Compiler (Phase 4). No bidirectional sync. `CampusDocument` is the source of truth; the Graph is a rendering artifact until Phase 4.

## Rollback Points

- After T3 (selection wired) — revert `EditorBridge` selection sync; studio still works
- After T5 (legacy relocated) — move back from `legacy/` or `git revert`; one commit
- After T6 (verified) — full milestone committed

## Public API Freeze

```ts
<PropertiesPanel />                                          // reads selection + document from EditorProvider
dispatcher.execute({ id:'entity.update', payload:{ entityId, changes } })
function useDocumentVersion(): number
new SelectionBridge(sm).connect({ onSelectionChanged })
selectionBridge.pushExternal(selector, origin)
```

---

## Task Breakdown

### T1 — EditorBridge: single context + DocumentStore + dispatcher + history (frozen order)

- [ ] New `packages/editor/src/context/document-store.ts`: `DocumentStore` class — holds `document` reference + `version` + reserved `revision`; stable arrow `getVersion`/`subscribe`; `commit()` increments version and notifies subscribers
- [ ] Add `documentStore: DocumentStore` to `ServiceMap` in `packages/editor/src/context/service-registry.ts` (import type; backward compatible)
- [ ] `EditorBridge`: build context **once** via `useState(() => buildContext(useGraphStore.getState().graph))` (NOT `useMemo([graph])`) — enforces the lifetime invariant
- [ ] Inside `buildContext`:
  - `const document = createDocument(graph)`; `const documentStore = new DocumentStore(document)`
  - `const registryCmd = new CommandRegistry(); registryCmd.register(entityUpdateHandler)`
  - `const dispatcher = new CommandDispatcher(registryCmd, document, eventBus)`
  - `const history = new HistoryStack(dispatcher, document, registryCmd); dispatcher.addPreHook(history); dispatcher.addPostHook(history)`
  - register `'documentStore'`, `'dispatcher'`, `'history'`, `'selection'` in the `ServiceRegistry`; `registry.init(document)`
- [ ] `createDocument(graph)`: no version field (version lives in `DocumentStore`)
- [ ] `CommandDispatcher.execute`: after the success transaction (history push + `entity.updated`), call `this.documentStore?.commit()` then `eventBus.emit('document.changed', { version, entityId, entityType })`. Add `private documentStore?: DocumentStore` obtained in `init(context)` via `context.get('documentStore')`. **Frozen order:** handler → history (pre/postHook) → `documentStore.commit()` → `document.changed`
- [ ] New `packages/editor/src/context/use-document-version.ts`: `useDocumentVersion()` — `useSyncExternalStore(store.subscribe, store.getVersion)` on `services.get('documentStore')` (**NOT** EventBus)
- **Acceptance:** Edit a field in `PropertiesPanel` dispatches `entity.update` (no "dispatcher undefined"); `documentStore.version` increments; React re-renders via `DocumentStore` subscription; no recreation on selection/edit. Grep gate clean in panel files.

### T2 — Version-driven re-render (Explorer + Inspector)

- [ ] `PropertiesPanel.tsx`: remove `entity.updated` subscription; use `const version = useDocumentVersion()` so the component re-renders on version commit (edit + undo reflect)
- [ ] `ExplorerPanel.tsx`: use `useDocumentVersion()` to re-render on edits (tree label reflects Inspector edits)
- **Acceptance:** Editing a room name updates the value shown AND the Explorer tree label. Undo reverts both. No infinite loop.

### T3 — Connect SelectionBridge (canvas ↔ SelectionManager, selection only)

- [ ] In `EditorBridge.buildContext`, instantiate `SelectionBridge(selectionManager)`
- [ ] `bridge.connect({ onSelectionChanged(state, legacy) { useStudioStore.setState({ selectedNodeId: legacy.selectedNodeId, activeBuildingId: legacy.activeBuildingId }) } })`
- [ ] Subscribe to `useStudioStore` selection changes; on change, resolve the legacy id to an entity type via `findEntityById(document, id)` and `bridge.pushExternal({ type, id }, SelectionOrigin.Canvas)` (loop-guarded)
- [ ] Clean up subscriptions on unmount
- **Acceptance:** Clicking an entity on the canvas opens the correct `PropertiesPanel`. Clicking in Explorer highlights canvas + opens Inspector. No sync loop.

### T4 — Single bridge + mount PropertiesPanel

- [ ] In `StudioWorkspace.tsx`, wrap **both** `ExplorerPanel` and `PropertiesPanel` in ONE `<EditorBridge>`; remove legacy `<RightPanel />` import + usage
- **Acceptance:** Right panel shows `PropertiesPanel` (empty state when nothing selected); Explorer + Inspector share selection.

### T5 — Relocate legacy inspector cluster to `legacy/`

- [ ] Create `src/components/studio/legacy/`; move `RightPanel.tsx`, `NodePropertiesPanel.tsx`, `MetadataPanel.tsx`, `TracePropertiesPanel.tsx`, `StaircasePropertiesPanel.tsx` there (no content change, just location)
- [ ] Fix any remaining imports; confirm nothing mounts them
- [ ] Confirm grep gate: no `useGraphStore`/`useStudioStore`/`useCampusMapStore` outside `EditorBridge`/`SelectionBridge`/legacy-canvas code
- **Acceptance:** App builds; legacy inspector files present in `legacy/` but unused; no broken imports.

### T6 — Integration tests + full verification

- [ ] Add `src/components/studio/__tests__/InspectorMigration.test.tsx`:
  - select entity via `SelectionManager` → `PropertiesPanel` shows correct panel + fields
  - edit field → `entity.update` dispatched → `CampusDocument` updated → field shows new value
  - undo → value reverts
  - canvas selection (`useStudioStore` change) → `PropertiesPanel` shows entity (via bridge)
  - document reference stable across selection/edit (invariant)
- [ ] Run full suite: all pre-existing tests (736+) still pass + new tests
- [ ] Run grep gate
- [ ] Manual smoke: select building/room/floor/hallway/entrance/staircase/elevator in Explorer → correct panel; edit + undo works
- **Acceptance:** All checks green.

### T7 — Docs

- [ ] Update `docs/roadmap/implementation-roadmap.md` change log: M2.3 started/complete; note Phase 4 rename to "Navigation Compiler" + Graph-as-compiled-artifact framing
- [ ] Update `.superpowers/sdd/progress.md` task ledger
- **Acceptance:** Change log reflects M2.3 + the architectural invariants.

---

## Definition of Done (per task)

Each task is Done when:
1. Its acceptance criteria pass
2. Grep gate clean (no legacy store imports in new/migrated Inspector files)
3. No new TypeScript errors introduced in touched files
4. All existing tests still pass
5. Changes committed atomically (one commit per task)

## Verification Summary (end of milestone)

- [ ] All 7 tasks complete, committed
- [ ] 736+ existing tests pass + new integration tests pass
- [ ] Grep gate: legacy stores only in sanctioned adapters
- [ ] Inspector edits `CampusDocument` with undo; Explorer reflects via version; single bridge; SelectionBridge selection-only
- [ ] Legacy inspector cluster relocated to `legacy/` (not deleted)
- [ ] `CampusDocument` lifetime invariant enforced (created once)
