# M2.3: Inspector Migration

**Date:** 2026-07-10
**Status:** Design — for approval (v3, required changes applied)

## Objective

Mount the already-built `PropertiesPanel` (per-entity property editors driven by `CampusDocument`) into NAVI Studio's right panel, wiring it through the real architecture: `EditorProvider` context, `SelectionManager`, and the `entity.update` command. This replaces the legacy Zustand/graph-mutation inspector cluster (`RightPanel` + `NodePropertiesPanel` + `MetadataPanel` + `TracePropertiesPanel` + `StaircasePropertiesPanel`) **as the active editor** (the legacy files are relocated to `legacy/`, not deleted yet).

> **M2.3 completes editing of `CampusDocument`. It does not complete editing of the visual map.**

The visual map (legacy canvas) continues to render from the legacy Graph. Making the map reflect `CampusDocument` edits is deferred to the Navigation Compiler work (Phase 4).

---

## Architectural Rule (decided for this milestone)

> **`CampusDocument` is now the source of truth for all editor data.** The Inspector reads from `CampusDocument` and writes through Commands. The legacy Graph is treated as a **rendering artifact** until Phase 4, where it becomes a **compiled navigation artifact** (produced by the Navigation Compiler) rather than an editable model. **No changes ever flow from the Graph back into `CampusDocument`.**

### Invariants

These are architectural invariants, not conveniences:

1. **`CampusDocument` lifetime** — exactly one `CampusDocument` instance per loaded map. Created once when a project is opened/imported/loaded. **Never recreated** on selection change, Inspector edit, or legacy Graph mutation. Only a new open/import/load recreates it.
2. **Single editor context** — `ExplorerPanel` and `PropertiesPanel` share ONE `EditorBridge` (one document, one `SelectionManager`, one dispatcher). Never separate bridges.
3. **`SelectionBridge` bridges selection only** — translates selection state between the legacy store and `SelectionManager`. Carries no document/command/rendering logic.
4. **`DocumentStore` is the render subscription source** — React re-renders are driven by `DocumentStore` (via `useDocumentVersion()`), **not** by the EventBus. The EventBus is for **cross-service coordination only** (autosave, validation, compiler, workflow).
5. **Editor metadata ≠ domain data** — `version` and `revision` live in `DocumentStore`, **never** on `CampusDocument`. `CampusDocument` stays pure domain data.
6. **Frozen command order** — `CommandDispatcher.execute` follows the exact sequence in the next section. No implementer may reorder version-commit / history / events.
7. **No legacy store writes from the Inspector** — writes only via `entity.update`.

---

## CommandDispatcher Execution Order (FROZEN INVARIANT)

This ordering is intentional and may not be changed without an architecture decision.

```
CommandDispatcher.execute(command):
│
├─ 1. preHooks.before(command)
│        └─ HistoryStack.before → snapshots document (pendingBeforeHash)
│
├─ 2. result = handler.execute(this.document, command.payload)
│
├─ 3. if result.success:
│     │
│     ├─ a. eventBus.transaction(() => {
│     │        postHooks.after(command, result)
│     │          └─ HistoryStack.after → history.push(entry)
│     │               entry.inverse = handler.inverse(payload, result)
│     │                 └─ oldValues captured by handler in result.data
│     │        eventBus.emit('entity.updated', { entityId, entityType })
│     │     })
│     │
│     ├─ b. documentStore.commit()
│     │        └─ version++  AND  notify React subscribers (useDocumentVersion)
│     │
│     └─ c. eventBus.emit('document.changed', { version, entityId, entityType })
│              └─ coordination only (autosave / validation / compiler / workflow)
│
└─ 4. return result
```

**`skipHooks` semantics (frozen):** `dispatcher.execute(cmd, { skipHooks: true })` is used ONLY by `history.undo()` / `history.redo()` to replay a command without recording a new history entry. It skips `PreHook`/`PostHook` (so `HistoryStack` does not push a duplicate entry) — but it does **NOT** skip command execution, `documentStore.commit()`, or the `document.changed` / `entity.updated` coordination events. Undo/redo still commit the version and re-render React normally; only history recording is suppressed.

Key points:
- **History records the post-change inverse** derived from `result.data.oldValues` (captured inside the handler). It is wired as a `PreHook` + `PostHook` on the dispatcher, which is why it is sequenced naturally.
- **`documentStore.commit()` is the single render trigger.** It increments `version` and notifies React subscribers. It happens once per successful command.
- **`document.changed` and `entity.updated` are coordination events** for other services. React does NOT subscribe to them for repaints.

---

## Architecture

```
CampusDocument  (pure domain data — single instance, mutated in place by commands)
      │
      │  DocumentStore.commit() on every command
      ▼
DocumentStore  (editor metadata: version, revision; subscribe/getVersion/commit)
      │
      ▼
useDocumentVersion()  ──▶ PropertiesPanel + Explorer re-render
      │
SelectionManager  (selection.lastSelectedId, selection.changed event)
      │
      ▼
PropertiesPanel  (reads selectedId, resolves entity via findEntityById)
      │
      ┌────┴──────────────┐
      │                   │
BuildingProperties  RoomProperties  ... (10 per-entity panels)
      │
      └── dispatcher.execute({ id:'entity.update', payload:{ entityId, changes } })
                 │
                 ▼
         CommandDispatcher (frozen order above)
                 │
                 ├──▶ documentStore.commit() ──▶ React re-render
                 ├──▶ entity.updated   (coordination)
                 └──▶ document.changed (coordination)
```

### Selection sync (canvas ↔ Inspector) — selection only

```
Canvas click → useStudioStore.selectedNodeId (legacy)
   │
   ▼
SelectionBridge.pushExternal(id → selector)   [legacy → new, loop-guarded]
   │
   ▼
SelectionManager.select(selector) → eventBus 'selection.changed'
   ├──▶ PropertiesPanel re-renders (shows entity)
   ├──▶ Explorer highlights entity
   └──▶ SelectionBridge.onSelectionChanged ──▶ useStudioStore.setState  [new → legacy, loop-guarded]
```

`SelectionBridge` knows nothing about documents, commands, or rendering. It only translates selection.

---

## CampusDocument Contract

The architectural contract every subsystem relies on:

```
CampusDocument
├── Identity      (schemaVersion, ids)
├── Metadata      (name, description, timestamps — domain metadata)
├── Hierarchy     (buildings → floors → rooms/hallways/staircases/elevators/entrances)
├── Entities      (roads, panoramas, qrCheckpoints)
└── (Editor State is NOT here)

DocumentStore  (separate, editor-owned)
├── document: CampusDocument   (reference, not copied)
├── version: number            (render trigger; not domain data)
└── revision: string           (reserved changeId/revisionId for future systems)
```

`CampusDocument` is pure domain data and is serializable as-is. Editor runtime state lives in `DocumentStore`.

---

## Data Flow

### Edit a field (Inspector → CampusDocument)

```
Field onChange → dispatcher.execute({ id:'entity.update', payload:{ entityId, changes } })
   │  (frozen order: handler → history → documentStore.commit → document.changed)
   ▼
entityUpdateHandler mutates document in place (captures oldValues)
   │
   ▼
DocumentStore.commit() → useDocumentVersion() returns new version
   │
   ├──▶ PropertiesPanel re-renders → shows new value (fresh read from document)
   └──▶ Explorer re-renders (same hook) → shows new name in tree
   │
Selection preserved (by EntityId); document reference stable (invariant)
```

### Undo / Redo

```
history.undo() → dispatcher.execute(inverseCmd, { skipHooks:true })
   │  inverse derived from result.data.oldValues
   ▼
document mutated back → documentStore.commit() → both panels re-render to previous value
```

### Select from canvas (legacy → Inspector)

```
Canvas click sets useStudioStore.selectedNodeId
   │
   ▼
EditorBridge subscribes to studio-store selection
   │
   ▼
SelectionBridge.pushExternal(resolvedSelector)  [loop-guarded]
   │
   ▼
SelectionManager.select → 'selection.changed' → PropertiesPanel shows entity
```

---

## Components

### DocumentStore (new — `packages/editor/src/context/document-store.ts`)

```ts
export class DocumentStore {
  version = 0
  revision = ''                                   // reserved changeId/revisionId
  private listeners = new Set<() => void>()
  constructor(public readonly document: CampusDocument) {}

  getVersion = (): number => this.version
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  commit(): void {                                  // increment version AND notify React subscribers
    this.version++
    this.listeners.forEach((l) => l())
  }
}
```
- Holds the `CampusDocument` reference (not a copy) + editor metadata (`version`, `revision`).
- Registered as the `'documentStore'` service.
- `getVersion` / `subscribe` are stable arrow properties (safe for `useSyncExternalStore`).

### useDocumentVersion (new — `packages/editor/src/context/use-document-version.ts`)

```ts
export function useDocumentVersion(): number {
  const { services } = useEditor()
  const store = services.get('documentStore')
  if (!store) return 0
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
```
React subscribes to **`DocumentStore`**, not the EventBus. This is the only render-subscription path.

### PropertiesPanel (already built — `packages/editor/src/panels/properties/PropertiesPanel.tsx`)

- Reads `useEditor()` → `{ document, services }`; selected id from `services.get('selection').lastSelectedId`
- **M2.3 change**: use `const version = useDocumentVersion()` to re-render on edits/undo (no EventBus `entity.updated` subscription)
- Resolves entity via `findEntityById(document, selectedId)`; switches on `found.path`

### Per-entity panels (already built — `packages/editor/src/panels/properties/*-props.tsx`)

Each: `useEditor()` → `services.get('dispatcher')` → `update(changes)` → `dispatcher.execute({ id:'entity.update', payload:{ entityId, changes } })`.

| Panel | Entity | Editable fields |
|-------|--------|-----------------|
| `building-props` | building | name, code, category, description, color, baseElevation, height |
| `floor-props` | floor | label, elevation (level readonly) |
| `room-props` | room | name, number, category, capacity |
| `hallway-props` | hallway | name, width, color |
| `road-props` | road | name, width, surface, type |
| `entrance-props` | entrance | label, type, hasQR, hasPanorama |
| `staircase-props` | staircase | name, fromLevel, toLevel, type |
| `elevator-props` | elevator | name, fromLevel, toLevel |
| `panorama-props` | panorama | label, heading, imageAssetId |
| `qr-props` | qr | label, code |

### EditorBridge (modify — `src/components/studio/EditorBridge.tsx`)

Currently registers only `eventBus` + `selection`, and recreates the document inside `useMemo([graph])`. M2.3 changes:

1. **Create context ONCE** via `useState(() => buildContext(useGraphStore.getState().graph))` (enforces the lifetime invariant; document never recreated on selection/edit/graph change).
2. **DocumentStore** — `new DocumentStore(document)`; register as `'documentStore'`.
3. **CommandDispatcher** — `new CommandRegistry()`, `registryCmd.register(entityUpdateHandler)`, `new CommandDispatcher(registryCmd, document, eventBus)`, register as `'dispatcher'`.
4. **HistoryStack** — `new HistoryStack(dispatcher, document, registryCmd)`; `dispatcher.addPreHook(history)` + `dispatcher.addPostHook(history)`; register as `'history'`.
5. **SelectionBridge** — `new SelectionBridge(selectionManager)`, `connect({onSelectionChanged})` → `useStudioStore.setState(...)`; subscribe to `useStudioStore` selection changes → `bridge.pushExternal(resolvedSelector, SelectionOrigin.Canvas)`.
6. **Dispatch wiring** — `CommandDispatcher.init` grabs `context.get('documentStore')` (added to `ServiceMap`) so `execute` can call `documentStore.commit()`.
7. Wrap **both** `ExplorerPanel` and `PropertiesPanel` in this single bridge.

### CommandDispatcher (modify — `packages/editor/src/commands/dispatcher.ts`)

After the success transaction (history + `entity.updated`), add:
```ts
this.documentStore?.commit()
this.eventBus.emit('document.changed', { version: this.documentStore?.version, entityId: result.entityId, entityType: command.id.split('.')[0] })
```
plus `private documentStore?: DocumentStore` obtained in `init(context)`.

### ServiceMap (modify — `packages/editor/src/context/service-registry.ts`)

Add `documentStore: DocumentStore` to `ServiceMap` (and import type). Backward compatible.

### StudioWorkspace (modify — `src/components/studio/StudioWorkspace.tsx`)

- Wrap `ExplorerPanel` **and** `PropertiesPanel` in ONE `<EditorBridge>`, replacing legacy `<RightPanel />`.

### Relocated (move to `src/components/studio/legacy/`, do NOT delete)

- `RightPanel.tsx`, `NodePropertiesPanel.tsx`, `MetadataPanel.tsx`, `TracePropertiesPanel.tsx`, `StaircasePropertiesPanel.tsx`

Kept as reference until after StudioCanvas (M2.6) migration, then deleted.

---

## Known Limitations (explicitly out of scope for M2.3)

1. **Canvas does not reflect Inspector edits yet** — write-back via the Navigation Compiler is deferred to Phase 4.
2. **`createDocument` drops roads/panoramas/qrCheckpoints** (`[]`) — those panels have no studio data in M2.3 (unit-tested, light up later).
3. **No inline validation** — deferred to M1.1.
4. **No Workspace Overview / Workflow Card / sections / auto-save indicator** — later enhancements.
5. **Legacy inspector files retained** in `legacy/` (deleted after M2.6).
6. **`revision` reserved but unused** — populated by future change-tracking systems.

---

## Public API Freeze

```ts
<PropertiesPanel />                                           // reads selection + document from EditorProvider
dispatcher.execute({ id:'entity.update', payload:{ entityId, changes } })
function useDocumentVersion(): number                         // subscribes to DocumentStore
new DocumentStore(document)                                   // version + revision + subscribe/commit
new SelectionBridge(sm).connect({ onSelectionChanged })
selectionBridge.pushExternal(selector, origin)
```

---

## Files

### Modified

| File | Change |
|------|--------|
| `src/components/studio/EditorBridge.tsx` | Context once (invariant); register `documentStore` + `dispatcher` + `history`; wire `SelectionBridge`; wrap Explorer + PropertiesPanel |
| `src/components/studio/StudioWorkspace.tsx` | Single bridge wraps both panels; remove legacy `RightPanel` |
| `packages/editor/src/panels/properties/PropertiesPanel.tsx` | Use `useDocumentVersion()` (not EventBus subscription) |
| `src/components/studio/ExplorerPanel.tsx` | Use `useDocumentVersion()` to re-render on edits |
| `packages/editor/src/commands/dispatcher.ts` | `documentStore.commit()` + `document.changed` after success (frozen order) |
| `packages/editor/src/context/service-registry.ts` | Add `documentStore: DocumentStore` to `ServiceMap` |
| New: `packages/editor/src/context/document-store.ts` | `DocumentStore` class |
| New: `packages/editor/src/context/use-document-version.ts` | `useDocumentVersion()` hook |

### Relocated (do not delete)

`src/components/studio/legacy/{RightPanel,NodePropertiesPanel,MetadataPanel,TracePropertiesPanel,StaircasePropertiesPanel}.tsx`

### Already built (no change unless bug found)

`packages/editor/src/panels/properties/*-props.tsx`, `property-utils.ts`, `field.tsx`, `index.ts`.

---

## Performance Contract

| Operation | Target |
|-----------|--------|
| Inspector field edit | <100 ms (dispatch + version re-render) |
| Selection → panel switch | <1 frame |
| Undo/redo | <100 ms |
| Re-render after edit | version-driven via `DocumentStore` (EventBus not on render path) |

---

## Verification Checklist

### Core behavior
1. **Select entity (Explorer)** → `PropertiesPanel` shows correct per-type panel + fields
2. **Select entity (canvas)** → `PropertiesPanel` shows entity (via `SelectionBridge`)
3. **Edit a text field** → `entity.update` dispatched → `CampusDocument` updated → field shows new value
4. **Edit reflects in Explorer** → tree label updates (shared version)
5. **Undo** → field reverts; **Redo** → reapplies
6. **Switch selection** → panel switches
7. **Deselect** → empty state shown
8. **Document not recreated** on selection/edit (reference stable; selection + undo persist)

### Architecture gates
9. **No direct legacy store imports** in new/migrated Inspector files (grep gate)
10. **No `graph-store` writes** from the Inspector
11. **Single bridge** — both panels share one `EditorBridge`
12. **`SelectionBridge` selection-only**
13. **Version-driven re-render** — `useDocumentVersion()` subscribes to `DocumentStore`, NOT EventBus; no per-component `entity.updated` rendering subscriptions
14. **`version`/`revision` NOT on `CampusDocument`** — live in `DocumentStore`
15. **Frozen command order** — `documentStore.commit()` after history push; `document.changed` is coordination only
16. **All existing tests pass** (736+) + new integration tests

### Resilience
17. **Selection stable** after edit (by `EntityId`)
18. **No infinite re-render loop** (stable store subscription; cleaned up)
19. **Legacy canvas still works** (renders from `graph-store`)
20. **Legacy files relocated** to `legacy/`, not deleted

---

## Error Prevention

| Scenario | Prevention |
|----------|-----------|
| Dispatcher undefined in panels | Register `dispatcher` + `entityUpdateHandler` in `EditorBridge` |
| Inspector stale after edit | `useDocumentVersion()` forces re-render on `DocumentStore.commit()` |
| Selection lost after edit | Compare by `EntityId`; document not recreated (invariant) |
| Selection sync loop | `SelectionBridge` recursion guard; only push external on genuine studio-store change |
| Legacy id type mismatch | Resolve `selectedNodeId` to entity type via `findEntityById` before `pushExternal` |
| Document recreated on graph change | Context created ONCE via `useState` initializer reading `getState().graph` |
| Two bridges / split selection | Both panels wrapped in ONE `EditorBridge` |
| Render depends on EventBus | `useDocumentVersion` subscribes to `DocumentStore`; EventBus is coordination-only |
| version in domain model | `version`/`revision` live in `DocumentStore`, never on `CampusDocument` |

---

## Out of Scope

- ❌ Canvas write-back / Navigation Compiler (Phase 4)
- ❌ Inline validation (M1.1)
- ❌ Workspace Overview / Workflow Card (M2.5)
- ❌ Advanced sections, auto-save indicator, image upload, delete/duplicate buttons
- ❌ Multi-select inspector
- ❌ Deleting `legacy/` inspector files (after M2.6)
- ❌ Retiring `graph-store` (Phase 4)
