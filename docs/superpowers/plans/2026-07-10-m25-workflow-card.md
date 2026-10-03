# M2.5 — Workflow Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task.

**Goal:** Build the Workflow Card — an orchestration panel powered by service-layer infrastructure (WorkflowStore, WorkflowService, NavigationCompiler, PersistenceService).

---

## Global Constraints

1. Workflow Card is an addition — never remove or break existing PropertiesPanel functionality
2. `WorkflowStore` follows DocumentStore pattern (plain class with `subscribe`/`commit`) but exposes `getSnapshot()` returning an immutable object (canonical `useSyncExternalStore` API)
3. **Only `WorkflowService` mutates `WorkflowStore`** — UI code reads snapshots only
4. `NavigationCompiler` is stateless — no `lastResult`, no cached state
5. `WorkflowService` is a pure orchestrator — it calls services and writes to WorkflowStore
6. `NavigationCompiler` lazy-imports `@navi/compiler` via `await import()` — never bundled at app load
7. `PersistenceService` wraps graph-store through an injected adapter, not a direct import
8. `PersistenceService.save()` is a pure persist — no concept of manual vs autosave. `WorkflowService` owns that distinction and decides which events to emit
9. Publish always runs compile fresh — never gates on cached result
10. All new services extend `BaseEditorService`; WorkflowStore is a plain class (like DocumentStore)
11. Workflow Card is editor-mode agnostic
12. **ValidationRegistry → ValidationEngine rename is deferred** to a separate cleanup milestone

---

## Tasks

### T1 — Create NavigationCompiler

**Description:** Stateless service that wraps `@navi/compiler`. Pure compile-and-return.

```typescript
class NavigationCompiler extends BaseEditorService {
  readonly id = 'navigationCompiler'
  readonly dependencies: readonly string[] = ['eventBus']

  async compile(document: CampusDocument): Promise<CompileResult>
}
```

`CompileResult`: `{ status: 'success' | 'error', message?: string, artifacts?: PublishedArtifacts, timestamp: number }`.

**Acceptance:** `compile()` lazy-loads `@navi/compiler` on first call. Returns success/error. Concurrent calls return the in-flight promise. No cached state (no `lastResult` property).

**Errors to prevent:**
- Guard concurrent calls — if already running, return in-flight promise
- `@navi/compiler` is a dev dependency — handle missing package gracefully (error result, not crash)
- No React imports — this is a plain TypeScript service

**Files:** `packages/editor/src/services/navigation-compiler.ts`

---

### T2 — Create PersistenceService

**Description:** Pure persistence service with adapter DI. No UI event logic.

```typescript
interface PersistenceAdapter {
  save(): Promise<void>
  syncToSupabase(): Promise<void>
  publish(artifacts: PublishedArtifacts): Promise<PublishResult>
}

class PersistenceService extends BaseEditorService {
  readonly id = 'persistence'
  readonly dependencies: readonly string[] = ['eventBus']

  constructor(private adapter: PersistenceAdapter) { super() }

  async save(): Promise<void>                    // no 'reason' param — pure persist
  async publish(artifacts: PublishedArtifacts): Promise<PublishResult>
}
```

**Key design:** No manual/autosave distinction. No events emitted. No cached state. `WorkflowService` decides what events to emit after calling save. `WorkflowService` also tracks status transitions.

**Acceptance:** `save()` calls adapter.save() and returns. `publish()` calls adapter.publish() and returns result.

**Errors to prevent:**
- Adapter reference must use `getState()` closure, not capture stale graph-store reference
- Do NOT add a `reason` parameter — that's WorkflowService's concern
- Do NOT add event emission — that's WorkflowService's concern

**Files:** `packages/editor/src/services/persistence-service.ts`

---

### T3 — Create WorkflowStore

**Description:** Reactive state container. Same pattern as DocumentStore, but exposes `getSnapshot()` returning an immutable object.

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

  subscribe(listener: () => void): () => void
  getSnapshot(): WorkflowSnapshot       // immutable snapshot — canonical for useSyncExternalStore

  // Mutators — ONLY called by WorkflowService (documented invariant)
  setValidation(result: ValidationResult): void
  setCompile(result: CompileResult): void
  setSave(timestamp: number, reason: 'manual' | 'autosave'): void
  setPublish(timestamp: number): void
  setSyncStatus(status: SyncStatus): void

  private commit(): void  // increments version + notifies listeners
}
```

**Invariant:** Only WorkflowService calls the `set*` mutators. UI code calls `getSnapshot()` only. This prevents accidental state corruption and keeps data flow unidirectional.

**Acceptance:** Subscribers notified on commit. `getSnapshot()` returns a stable snapshot object (new reference only when version changes).

**Files:** `packages/editor/src/services/workflow-store.ts`

---

### T4 — Create WorkflowService (orchestrator)

**Description:** Coordinates actions across services. Owns the manual/autosave distinction and event logic. Updates WorkflowStore.

```typescript
class WorkflowService extends BaseEditorService {
  readonly id = 'workflow'
  readonly dependencies = [
    'navigationCompiler', 'persistence', 'validation',
    'documentStore', 'workflowStore', 'eventBus',
  ]

  async validate(): Promise<ValidationResult>
  async compile(): Promise<CompileResult>
  async save(reason: 'manual' | 'autosave'): Promise<void>
    // calls PersistenceService.save()
    // manual → emits workflow.saved, busy/ready status transitions
    // autosave → silent, no events
    // both → updates WorkflowStore lastSave + lastSaveVersion
  async publish(): Promise<PublishResult>

  isDirty(): boolean  // documentStore.version > workflowStore.lastSaveVersion
}
```

**Publish flow:**
1. Check `isDirty()` → if dirty, reject with "Save first"
2. Call `NavigationCompiler.compile(document)`
3. On compile error → WorkflowStore.setCompile(error), return error
4. On compile success → WorkflowStore.setCompile(success)
5. Call `PersistenceService.publish(artifacts)`
6. On publish success → WorkflowStore.setPublish(timestamp), return success

**Acceptance:** `save('manual')` persists + emits event + writes to WorkflowStore. `save('autosave')` persists silently + writes to WorkflowStore. `publish()` always recompiles. `isDirty()` reflects document changes.

**Errors to prevent:**
- `save()` must update `lastSaveVersion` on WorkflowStore (for `isDirty()`)
- `publish()` must NOT use cached compile result — always compile fresh
- Autosave must NOT emit `workflow.saved` event (prevents unnecessary UI re-renders)

**Files:** `packages/editor/src/services/workflow-service.ts`

---

### T5 — Register in EditorBridge + update ServiceMap

**Description:** Add new services to `ServiceMap`. Register and inject in `EditorBridge.buildContext()`.

```typescript
// ServiceMap additions
export interface ServiceMap {
  // ...existing (no rename of ValidationRegistry)
  navigationCompiler: NavigationCompiler
  persistence: PersistenceService
  workflowStore: WorkflowStore
  workflow: WorkflowService
}
```

In `EditorBridge.tsx`:
```typescript
const persistenceAdapter: PersistenceAdapter = {
  save: () => graphStore.getState().save(),
  syncToSupabase: () => graphStore.getState().syncToSupabase(),
  publish: async (artifacts) => { /* POST to /api/publish */ },
}

const navCompiler = new NavigationCompiler()
const persistence = new PersistenceService(persistenceAdapter)
const workflowStore = new WorkflowStore()
const workflow = new WorkflowService()

registry.register('navigationCompiler', navCompiler)
registry.register('persistence', persistence)
registry.register('workflowStore', workflowStore)
registry.register('workflow', workflow)
```

**Acceptance:** Services registered in dependency order. `context.services.get('workflow')` returns the WorkflowService. Init order: navigationCompiler → persistence → workflowStore → workflow.

**Files:**
- `packages/editor/src/context/service-registry.ts` — ServiceMap update
- `src/components/studio/EditorBridge.tsx` — registration + adapter injection

---

### T6 — Create computeProgress pure helper

**Description:** Pure function that computes workflow progress from document content and WorkflowStore state.

```typescript
interface WorkflowProgress {
  buildings: boolean   // document.buildings.length > 0
  floors: boolean      // any building has floors.length > 0
  rooms: boolean       // any floor has rooms.length > 0
  traces: boolean      // any floor has hallways.length > 0
  validation: boolean  // store.lastValidation !== null
  compile: boolean     // store.lastCompile?.status === 'success'
  publish: boolean     // store.lastPublish !== null
  completed: number    // count of true steps
  total: number        // 7
}

function computeProgress(document: CampusDocument, snapshot: WorkflowSnapshot): WorkflowProgress
```

**Acceptance:** Returns correct progress for empty campus, partial campus, fully complete campus.

**Files:** `packages/editor/src/panels/workflow/workflow-progress.ts`

---

### T7 — Build WorkflowCard UI + useWorkflow hook

**Description:** Two parts:

**`useWorkflow()` hook:**
```typescript
function useWorkflow() {
  const { services } = useEditor()
  const store = services.get('workflowStore')!
  const workflow = services.get('workflow')!
  const documentStore = services.get('documentStore')!

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // snapshot is an immutable WorkflowSnapshot — re-reads only on version change

  return {
    dirty: workflow.isDirty(),
    snapshot,                                        // immutable, stable reference
    progress: computeProgress(documentStore.document, snapshot),
    validate: workflow.validate.bind(workflow),
    compile: workflow.compile.bind(workflow),
    save: () => workflow.save('manual'),
    publish: workflow.publish.bind(workflow),
  }
}
```

**`WorkflowCard` component — 6 sections:**
1. **Header** — campus name from `document.metadata.name`
2. **Workflow progress** — 7-step checklist rendered from `computeProgress()`
3. **Validation** — pass/fail badge, "Validate" button, spinner
4. **Compile** — status badge, "Compile" button, last-run timestamp
5. **Save** — dirty dot (red/green), last-save timestamp, "Save" button, sync status
6. **Publish** — "Publish" button (disabled when dirty or compile not succeeded)

**Acceptance:** All 6 sections render. Buttons disabled during their respective running states. Publish disabled when dirty. Progress updates reactively via snapshot.

**Errors to prevent:**
- Don't assume document is non-null — guard with early return
- `useSyncExternalStore` subscription must be stable (same subscribe/getSnapshot references)
- Button loading states must be independent

**Files:**
- `packages/editor/src/panels/workflow/useWorkflow.ts`
- `packages/editor/src/panels/workflow/WorkflowCard.tsx`
- `packages/editor/src/panels/workflow/index.ts`

---

### T8 — Wire WorkflowCard into PropertiesPanel

**Description:** Replace the "Select an entity" placeholder div with `<WorkflowCard />`. Export from `@navi/editor`.

**Acceptance:** No entity selected → Workflow Card. Entity selected → properties panel.

**Files:**
- `packages/editor/src/panels/properties/PropertiesPanel.tsx`
- `packages/editor/src/index.ts`

---

### T9 — Wire auto-save through PersistenceService

**Description:** Replace `graph-store.save()` call in `StudioWorkspace.tsx` auto-save interval with `WorkflowService.save('autosave')`.

```typescript
const { services } = useEditor()
useEffect(() => {
  const interval = setInterval(() => {
    services.get('workflow')?.save('autosave')
  }, 30000)
  return () => clearInterval(interval)
}, [services])
```

**Acceptance:** Auto-save persists every 30s. No toast/spinner. WorkflowStore updates reflected in Workflow Card.

**Files:** `src/components/studio/StudioWorkspace.tsx`

---

### T10 — Tests

| File | Tests |
|------|-------|
| `packages/editor/src/services/navigation-compiler.test.ts` | Lazy-load, success, error, concurrent guard |
| `packages/editor/src/services/persistence-service.test.ts` | Save, publish, adapter error handling |
| `packages/editor/src/services/workflow-store.test.ts` | Subscribe/getSnapshot/commit, snapshot immutability |
| `packages/editor/src/services/workflow-service.test.ts` | Dirty state, manual save emits event, autosave no event, publish recompiles, publish rejects when dirty |
| `packages/editor/src/panels/workflow/workflow-progress.test.ts` | Empty campus, partial campus, complete campus |
| `packages/editor/src/panels/workflow/WorkflowCard.test.tsx` | Render smoke test for each section |

**Acceptance:** 25+ new tests. All 753 existing tests still pass.

---

### T11 — Verify + Commit

- Run full test suite (target: 778+ passing)
- Verify Workflow Card renders in empty/campus/building states
- Verify PropertiesPanel still works when entity is selected
- Verify dirty → save → clean cycle
- Verify publish runs compile fresh
- Update progress/roadmap docs
- Commit both repos

---

## Verification Checklist

- [ ] `NavigationCompiler.compile()` returns success/error
- [ ] `NavigationCompiler` concurrent guard returns in-flight promise
- [ ] `PersistenceService.save()` persists via adapter
- [ ] `PersistenceService` has no `reason` param, no event emission
- [ ] `WorkflowStore.getSnapshot()` returns immutable object
- [ ] `WorkflowStore` mutators called only by WorkflowService (invariant documented)
- [ ] `WorkflowService.save('manual')` emits `workflow.saved` event
- [ ] `WorkflowService.save('autosave')` does NOT emit event
- [ ] `WorkflowService.isDirty()` reflects DocumentStore version changes
- [ ] `WorkflowService.publish()` runs compile fresh (not cached)
- [ ] `WorkflowService.publish()` rejects if dirty
- [ ] `WorkflowService.publish()` rejects if compile fails
- [ ] `computeProgress()` returns correct for all campus states
- [ ] Workflow Card renders in right panel when nothing selected
- [ ] PropertiesPanel renders when entity selected
- [ ] Auto-save goes through WorkflowService.save('autosave')
- [ ] All existing tests pass (753 baseline)
- [ ] 25+ new tests pass

---

## Task Dependency Graph

```
T1 (NavigationCompiler) ──┐
T2 (PersistenceService) ──┤
T3 (WorkflowStore) ───────┤
                          ▼
                    T4 (WorkflowService)
                          │
                          ▼
                    T5 (Register + ServiceMap)
                          │
                          ▼
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
      T6 (Progress)  T7 (UI+hook)  T9 (Auto-save)
              │           │
              └─────┬─────┘
                    ▼
              T8 (Wire into Panel)
                    │
                    ▼
              T10 (Tests)
                    │
                    ▼
              T11 (Verify + Commit)
```

Recommended execution order: **T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11**
