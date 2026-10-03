# M2.5 — Workflow Card Design

**Status**: Draft (v3 — final architecture)
**Date**: 2026-07-10
**Dependencies**: M2.4 (Selection Integration), M1.1 (ValidationEngine), M4 (Navigation Compiler)

---

## What

Build a **Workflow Card** — a persistent panel in the Studio workspace that acts as the editor's orchestration shell. It owns the entire authoring workflow: validation status, dirty state tracking, compile-to-preview, save, and publish.

All orchestration lives in **services** (not hooks), and all React subscriptions go through a **WorkflowStore** (not EventBus), matching the exact same pattern used by DocumentStore/useDocumentVersion and SelectionManager/useSelection.

---

## Architecture

### Service layer

```
EditorBridge
  │
  ├── DocumentStore         (existing — version counter, subscribe)
  ├── WorkflowStore         NEW — same pattern as DocumentStore
  ├── SelectionManager      (existing)
  ├── HistoryStack          (existing)
  ├── ValidationRegistry    (existing — rename to ValidationEngine deferred to cleanup)
  ├── NavigationCompiler    NEW — stateless, wraps @navi/compiler
  ├── PersistenceService    NEW — wraps graph-store behind adapter
  └── WorkflowService       NEW — orchestrator only, no state
```

### React layer

```
WorkflowCard (renders state from WorkflowStore, calls actions on WorkflowService)
        │
        ▼
useWorkflow()
  ├── useSyncExternalStore(workflowStore.subscribe, workflowStore.getVersion)
  │   re-reads latest workflowStore fields on each snapshot change
  └── delegates actions to WorkflowService (validate/compile/save/publish)
```

### Consistency across the codebase

```
Selection:
  SelectionManager → (internal revision) → useSelection()    ✓

Document:
  DocumentStore → useDocumentVersion()                       ✓

Workflow (NEW):
  WorkflowService → WorkflowStore → useWorkflow()            ✓
```

All three follow the same architecture:
1. A **service** owns the business logic (no React imports)
2. A **store** owns the reactive state (plain class with `subscribe`/`getSnapshot`)
3. A **hook** bridges React to the store via `useSyncExternalStore`

---

## Services (detailed)

### `NavigationCompiler` (stateless)

A pure compiler wrapper. No cached state — just compile and return.

```typescript
class NavigationCompiler extends BaseEditorService {
  readonly id = 'navigationCompiler'
  readonly dependencies: readonly string[] = ['eventBus']

  async compile(document: CampusDocument): Promise<CompileResult>
}
```

- Lazy-imports `@navi/compiler` on first call (not at service init)
- Concurrent calls are guarded (returns in-flight promise)
- No `lastResult`, no cached state — `WorkflowService` owns the result

### `PersistenceService`

Wraps legacy persistence behind an adapter interface. Pure persistence — no UI event logic.

```typescript
interface PersistenceAdapter {
  save(): Promise<void>
  syncToSupabase(): Promise<void>
  publish(artifacts: PublishedArtifacts): Promise<PublishResult>
}

class PersistenceService extends BaseEditorService {
  readonly id = 'persistence'
  readonly dependencies: readonly string[] = ['eventBus']

  async save(): Promise<void>                    // no 'reason' param — pure persist
  async publish(artifacts: PublishedArtifacts): Promise<PublishResult>
}
```

- Adapter is injected at construction time (from `EditorBridge`)
- No concept of "manual" vs "autosave" — that distinction belongs to `WorkflowService`
- No events emitted — WorkflowService decides what events to emit after calling save
- No cached state — success/failure status flows back through the return value

### `WorkflowStore`

Reactive state container, same pattern as DocumentStore, but exposes `getSnapshot()` (immutable object) instead of `getVersion()` (number) — aligning with `useSyncExternalStore`'s canonical API.

```typescript
interface WorkflowSnapshot {
  version: number
  lastValidation: ValidationResult | null
  lastCompile: CompileResult | null
  lastSave: { timestamp: number; reason: 'manual' | 'autosave' } | null
  lastPublish: { timestamp: number } | null
  syncStatus: SyncStatus
  lastSaveVersion: number
}

class WorkflowStore {
  readonly dependencies: readonly string[] = []
  private _version = 0

  private _lastValidation: ValidationResult | null = null
  private _lastCompile: CompileResult | null = null
  private _lastSave: { ... } | null = null
  private _lastPublish: { timestamp: number } | null = null
  private _syncStatus: SyncStatus = 'idle'
  private _lastSaveVersion = 0

  private listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void
  getSnapshot(): WorkflowSnapshot        // immutable snapshot — canonical for useSyncExternalStore

  // Mutators — ONLY called by WorkflowService
  setValidation(result: ValidationResult): void
  setCompile(result: CompileResult): void
  setSave(timestamp: number, reason: 'manual' | 'autosave'): void
  setPublish(timestamp: number): void
  setSyncStatus(status: SyncStatus): void

  private commit(): void  // _version++; notifyAll()
}
```

**Invariant: Only WorkflowService mutates WorkflowStore.** UI code reads snapshots via `getSnapshot()` and never calls mutators directly. This prevents accidental state corruption from React components and keeps the data flow unidirectional.

**Invariant: WorkflowService is the only public workflow API.** No UI code calls `PersistenceService.save()` or `NavigationCompiler.compile()` directly — they always go through `WorkflowService`. This preserves a single orchestration path and keeps business rules (dirty check, event emission) centralized.

- Registered in ServiceRegistry (has `dependencies: []` for topological sort compatibility, like DocumentStore)
- React subscribes via `useSyncExternalStore(store.subscribe, store.getSnapshot)`

### `WorkflowService` (orchestrator only)

Coordinates actions across services. Owns NO state — delegates to WorkflowStore. Owns the manual/autosave distinction and decides which events to emit.

```typescript
class WorkflowService extends BaseEditorService {
  readonly id = 'workflow'
  readonly dependencies = [
    'navigationCompiler', 'persistence', 'validation',
    'documentStore', 'workflowStore', 'eventBus',
  ]

  // Actions
  async validate(): Promise<ValidationResult>    // calls ValidationEngine, writes to WorkflowStore
  async compile(): Promise<CompileResult>         // calls NavigationCompiler, writes to WorkflowStore
  async save(reason: 'manual' | 'autosave'): Promise<void>
    // calls PersistenceService.save()
    // manual → emits workflow.saved event, busy/ready status
    // autosave → silent (no events)
    // both → writes lastSave + lastSaveVersion to WorkflowStore
  async publish(): Promise<PublishResult>         // compile fresh → publish on success → writes to WorkflowStore

  // Derived (pure, no state)
  isDirty(): boolean                              // documentStore.version > lastSaveVersion
}
```

---

## Data flow: Publish

```
User clicks "Publish"
        │
        ▼
WorkflowService.publish()
        │
        ├── isDirty()? → reject: "Save first"
        │
        ├── NavigationCompiler.compile(document)
        │     │
        │     ├── success → write lastCompile to WorkflowStore
        │     │
        │     └── error → write error to WorkflowStore, return
        │
        ├── PersistenceService.publish(artifacts)
        │     │
        │     └── success → write lastPublish to WorkflowStore
        │
        └── return PublishResult
```

Publish **always** compiles fresh — never gates on a stale cached result.

---

## Where the Workflow Card lives

The Workflow Card replaces the `PropertiesPanel` placeholder (the "Select an entity" empty state) in the right panel. When a user selects an entity, they see properties as today. When nothing is selected, they see the Workflow Card.

```
┌─────────────────────────────────────┐
│  Explorer  │  Canvas  │ Workflow   │
│            │          │ ────────── │
│            │          │ 🏛 Main    │
│            │          │   Campus   │
│            │          │ ────────── │
│            │          │ ✅ ✅ ✅   │
│            │          │ ● ● ●    │
│            │          │ ────────── │
│            │          │ ⚡ Validate│
│            │          │ 🛠 Compile │
│            │          │ 💾 Save    │
│            │          │ 📦 Publish │
└─────────────────────────────────────┘
```

---

## Success Criteria

1. **Dirty state tracking** — `WorkflowService.isDirty()` compares `DocumentStore.version` against last saved version. Workflow Card shows an unsaved indicator.
2. **Validation summary** — "Validate" button runs `ValidationEngine.validateAll()`. Results (pass/fail count, timestamp) displayed in card.
3. **Compile button** — Calls `NavigationCompiler.compile()`. Shows progress (running→success→error). Error state shows the error message.
4. **Save button** — Calls `PersistenceService.save('manual')`. Shows last-save timestamp, sync status. Auto-save calls `save('autosave')` without UI feedback.
5. **Publish button** — Always runs compile fresh, then publishes on success. Confirmation dialog with campus stats. Disabled when dirty.
6. **Workflow progress** — 7-step checklist (Buildings, Floors, Rooms, Traces, Validation, Compile, Publish) computed by pure `computeProgress(document, workflowStore)`.
7. **Auto-save integration** — Existing 30s interval calls `PersistenceService.save('autosave')`. Workflow Card reflects state.

## Non-Goals

- ❌ Canvas integration with compile errors (deferred to M3.x)
- ❌ Preview mode / navigation overlay (deferred to M3.x)
- ❌ Version history UI (deferred to M5)
- ❌ Rollback (deferred to M5)
- ❌ Inline validation in property panels (deferred to M1.1 follow-up)

---

## Files to Create/Modify

### New files
| File | Purpose |
|------|---------|
| `packages/editor/src/services/navigation-compiler.ts` | Stateless compiler service, lazy-imports `@navi/compiler` |
| `packages/editor/src/services/persistence-service.ts` | Persistence with adapter DI, `save(reason)` |
| `packages/editor/src/services/workflow-service.ts` | Orchestrator only — validate, compile, save, publish |
| `packages/editor/src/services/workflow-store.ts` | Reactive state container (like DocumentStore) |
| `packages/editor/src/services/index.ts` | Barrel exports |
| `packages/editor/src/panels/workflow/WorkflowCard.tsx` | Pure rendering component |
| `packages/editor/src/panels/workflow/useWorkflow.ts` | Thin hook: `useSyncExternalStore` + action delegation |
| `packages/editor/src/panels/workflow/workflow-progress.ts` | Pure `computeProgress(document, state)` |
| `packages/editor/src/panels/workflow/index.ts` | Barrel export |

### Modified files
| File | Change |
|------|--------|
| `packages/editor/src/context/service-registry.ts` | Update `ServiceMap`: add `navigationCompiler`, `persistence`, `workflow`, `workflowStore` |
| `packages/editor/src/panels/properties/PropertiesPanel.tsx` | Render `<WorkflowCard />` when `!selectedId` |
| `packages/editor/src/index.ts` | Export new services + WorkflowCard |
| `src/components/studio/EditorBridge.tsx` | Register new services, inject PersistenceAdapter |
| `src/components/studio/StudioWorkspace.tsx` | Auto-save → `PersistenceService.save('autosave')` via WorkflowService |
