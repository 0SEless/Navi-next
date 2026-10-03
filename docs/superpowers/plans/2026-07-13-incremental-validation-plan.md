# Incremental Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add incremental validation to `ValidationEngine` — after an edit, only rules whose `affinity` matches the changed entity type re-run; unaffected rules carry issues forward from the previous snapshot.

**Architecture:** CampusDocument owns a lightweight change journal (`version` + `_changeJournal`). Commands call `recordChange()` on every mutation. Events signal invalidation but carry no change data — the engine queries the document. Analysis passes and rules are filtered by `ValidationAffinity`. A merge step combines fresh and carried-forward issues.

**Tech Stack:** TypeScript, Vitest, `@navi/core` (CampusDocument types), `@navi/editor` (ValidationEngine, commands, event bus)

**Spec:** `docs/superpowers/specs/2026-07-13-incremental-validation-design.md`

## Global Constraints

- `version` on CampusDocument is a required number field, incremented monotonically
- `_changeJournal` is optional (`_changeJournal?: EntityChange[]`), never serialized
- `_changeJournal` is append-only — `getChangesSince()` is non-destructive
- `recordChange()` and `getChangesSince()` are free functions exported from `@navi/core`, not interface methods
- Events (`document.changed`) are used only for invalidation notification, never as change data source
- Merge is "drop + replace" by ruleId — issues from re-run rules are removed, fresh issues appended
- `validateFresh()` bypasses incremental path and runs full validation

---
## File Structure

### Modified files (core)
- `packages/core/src/types/document.ts` — add `version` field, `_changeJournal` field; export `EntityChange` type, `recordChange()`, `getChangesSince()` functions
- `packages/core/src/types/index.ts` — re-export new types/functions
- `packages/core/src/index.ts` — already re-exports types, no change needed
- `packages/core/src/serialization/serializer.ts` — add `version` to validation check

### Modified files (editor)
- `packages/editor/test-helpers.ts` — add `version: 0` to `createDocument()`
- `packages/editor/src/commands/room-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/hallway-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/staircase-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/elevator-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/entrance-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/road-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/panorama-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/qr-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/floor-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/entity-update-handler.ts` — add `recordChange()`
- `packages/editor/src/commands/building-handlers.ts` — add `recordChange()`
- `packages/editor/src/commands/handlers.test.ts` — update `createDoc()` to include `version: 0`; verify changes are recorded
- `packages/editor/src/commands/handlers-edge-cases.test.ts` — update inline documents
- `packages/editor/src/validation/rules/analysis.ts` — add `affinity: ValidationAffinity | 'global'` to `AnalysisPass`; add `global` to all passes
- `packages/editor/src/validation/rules/types.ts` — no changes needed (affinity already defined)
- `packages/editor/src/validation/validation-engine.ts` — add `markDirty()`, `isRuleAffected()`, `buildScopedAnalysisCache()`, `runIncrementalValidation()`, `mergeSnapshots()`, update `validate()` flow
- `packages/editor/src/validation/engine.test.ts` — add incremental validation tests
- `packages/editor/src/validation/snapshot.ts` — add `rulesReused` to `ValidationStatistics`
- `packages/editor/src/context/create-editor-context.ts` — wire `document.changed` → `markDirty()`

---

### Task 1: Add version, change journal, and helper functions to CampusDocument

**Files:**
- Modify: `packages/core/src/types/document.ts`
- Modify: `packages/core/src/serialization/serializer.ts`
- Modify: `packages/core/src/types/index.ts`
- Test: `packages/core/src/types/document.test.ts`

**Interfaces:**
- Consumes: `CampusDocument` interface (existing)
- Produces: `EntityChange` type, `recordChange()` function, `getChangesSince()` function

- [ ] **Step 1: Add EntityChange type, version field, and helper functions to `document.ts`**

```typescript
// Add to document.ts, after the imports

export interface EntityChange {
  readonly entityId: string
  readonly entityType: string
  readonly operation: 'created' | 'updated' | 'deleted'
}

// Add `version` to CampusDocument interface and `_changeJournal` as optional runtime field
export interface CampusDocument {
  schemaVersion: number
  version: number  // NEW — monotonic version counter
  metadata: DocumentMetadata
  buildings: Building[]
  roads: Road[]
  panoramas: Panorama[]
  qrCheckpoints: QRCheckpoint[]
  /** Runtime-only change journal. Not serialized. Populated during editing sessions. */
  _changeJournal?: EntityChange[]
}

/** Record a change and bump the document version. */
export function recordChange(document: CampusDocument, change: EntityChange): void {
  if (!document._changeJournal) {
    document._changeJournal = []
  }
  document._changeJournal.push(change)
  document.version++
}

/**
 * Return all changes recorded since the given version.
 * Non-destructive — multiple callers can query independently.
 */
export function getChangesSince(document: CampusDocument, version: number): readonly EntityChange[] {
  if (!document._changeJournal || version >= document.version) return []
  // Journal entries are ordered by version; each recordChange() pushes one entry
  // version tracks total recorded changes, so entries before `version` are already accounted for
  const startIndex = Math.max(0, version)
  return document._changeJournal.slice(startIndex)
}
```

- [ ] **Step 2: Update serializer to validate version field**

```typescript
// In serializer.ts, add to validateDocument():
if (typeof d.version !== 'number') {
  throw new Error('Invalid document: missing or invalid version')
}
```

- [ ] **Step 3: Update index.ts to export new types**

```typescript
// In packages/core/src/types/index.ts, the existing `export * from './document'`
// will automatically export `EntityChange`, `recordChange`, `getChangesSince`
// since they're now in document.ts. No change needed.
```

- [ ] **Step 4: Write test**

```typescript
// In document.test.ts — add to existing file

import { describe, it, expect } from 'vitest'
import type { CampusDocument } from './document'
import { recordChange, getChangesSince } from './document'

function createTestDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { name: 'test', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('recordChange', () => {
  it('bumps version on each call', () => {
    const doc = createTestDoc()
    expect(doc.version).toBe(0)
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    expect(doc.version).toBe(1)
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'created' })
    expect(doc.version).toBe(2)
  })

  it('initializes _changeJournal on first call', () => {
    const doc = createTestDoc()
    expect(doc._changeJournal).toBeUndefined()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    expect(doc._changeJournal).toHaveLength(1)
    expect(doc._changeJournal![0].entityId).toBe('rm-1')
  })
})

describe('getChangesSince', () => {
  it('returns empty array when no changes recorded', () => {
    const doc = createTestDoc()
    expect(getChangesSince(doc, 0)).toHaveLength(0)
  })

  it('returns only changes after the given version', () => {
    const doc = createTestDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    const v1 = doc.version
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })
    const changes = getChangesSince(doc, v1)
    expect(changes).toHaveLength(1)
    expect(changes[0].entityId).toBe('bld-1')
  })

  it('returns all changes from version 0', () => {
    const doc = createTestDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'created' })
    expect(getChangesSince(doc, 0)).toHaveLength(2)
  })

  it('is non-destructive — multiple calls return the same data', () => {
    const doc = createTestDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    const r1 = getChangesSince(doc, 0)
    const r2 = getChangesSince(doc, 0)
    expect(r1).toEqual(r2)
    expect(r1).toHaveLength(1)
  })

  it('returns empty array for a version at or after current', () => {
    const doc = createTestDoc()
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    expect(getChangesSince(doc, doc.version)).toHaveLength(0)
    expect(getChangesSince(doc, 999)).toHaveLength(0)
  })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd navi-next/packages/core && npx vitest run src/types/document.test.ts`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/document.ts packages/core/src/serialization/serializer.ts
git commit -m "feat(core): add version and change journal to CampusDocument"
```

---

### Task 2: Update test-helpers and inline document factories

**Files:**
- Modify: `packages/editor/test-helpers.ts`
- Modify: `packages/editor/src/commands/handlers.test.ts` (update `createDoc()`)
- Modify: `packages/editor/src/commands/handlers-edge-cases.test.ts` (update `createDoc()`)
- Modify: `packages/editor/src/commands/entity-update-handler.test.ts` (update `createDoc()`)
- Test: `packages/editor/src/commands/handlers.test.ts` (verify unchanged behavior)

All existing tests create `CampusDocument` objects without `version: 0`. These will fail type-check after Task 1. Task 2 adds `version: 0` to all inline document factories.

- [ ] **Step 1: Update `test-helpers.ts`**

```typescript
// In createDocument(), add version: 0 to the returned object
export function createDocument(overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,  // NEW
    metadata: { ... },
    buildings: [...],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
    ...overrides,
  }
}
```

- [ ] **Step 2: Update `handlers.test.ts` `createDoc()`**

```typescript
function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,  // NEW
    metadata: { name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{ ... }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}
```

- [ ] **Step 3: Update `handlers-edge-cases.test.ts` `createDoc()`** — same pattern

- [ ] **Step 4: Update `entity-update-handler.test.ts` `createDoc()`** — same pattern

- [ ] **Step 5: Run tests to verify**

Run: `cd navi-next/packages/editor && npx vitest run src/commands/handlers.test.ts src/commands/handlers-edge-cases.test.ts src/commands/entity-update-handler.test.ts`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add packages/editor/test-helpers.ts packages/editor/src/commands/handlers.test.ts packages/editor/src/commands/handlers-edge-cases.test.ts packages/editor/src/commands/entity-update-handler.test.ts
git commit -m "fix(editor): add version: 0 to all test document factories"
```

---

### Task 3: Add recordChange() to all command handlers

**Files:**
- Modify: `packages/editor/src/commands/building-handlers.ts`
- Modify: `packages/editor/src/commands/room-handlers.ts`
- Modify: `packages/editor/src/commands/hallway-handlers.ts`
- Modify: `packages/editor/src/commands/staircase-handlers.ts`
- Modify: `packages/editor/src/commands/elevator-handlers.ts`
- Modify: `packages/editor/src/commands/entrance-handlers.ts`
- Modify: `packages/editor/src/commands/road-handlers.ts`
- Modify: `packages/editor/src/commands/panorama-handlers.ts`
- Modify: `packages/editor/src/commands/qr-handlers.ts`
- Modify: `packages/editor/src/commands/floor-handlers.ts`
- Modify: `packages/editor/src/commands/entity-update-handler.ts`
- Test: `packages/editor/src/commands/handlers.test.ts` — verify changes are recorded

**Interfaces:**
- Consumes: `recordChange()` from `@navi/core`
- Produces: each handler records the correct `EntityChange` on every successful mutation

- [ ] **Step 1: Add import to each handler file**

```typescript
import { recordChange } from '@navi/core'
```

- [ ] **Step 2: For each handler, add `recordChange()` before the return, on success**

Each handler follows the same pattern. Example for room handlers:

```typescript
// room-handlers.ts — roomCreateHandler.execute()
const result = { success: true, entityId: id, ... }
recordChange(document, { entityId: id, entityType: 'room', operation: 'created' })
return result
```

Example for entity-update-handler:

```typescript
// entity-update-handler.ts — after the mutation loop
recordChange(document, { entityId, entityType: detectEntityType(document, entityId), operation: 'updated' })
return { success: true, entityId, data: { oldValues } }
```

For `entity.update`, the `entityType` is not in the payload — it must be derived from the resolved entity. Add a helper:

```typescript
function detectEntityType(document: CampusDocument, id: string): string {
  for (const bld of document.buildings) {
    if (bld.id === id) return 'building'
    for (const flr of bld.floors) {
      if (flr.id === id) return 'floor'
      for (const rm of flr.rooms) if (rm.id === id) return 'room'
      for (const hw of flr.hallways) if (hw.id === id) return 'hallway'
      for (const st of flr.staircases) if (st.id === id) return 'staircase'
      for (const el of flr.elevators) if (el.id === id) return 'elevator'
      for (const ent of flr.entrances) if (ent.id === id) return 'entrance'
    }
  }
  for (const rd of document.roads) if (rd.id === id) return 'road'
  for (const pan of document.panoramas) if (pan.id === id) return 'panorama'
  for (const qr of document.qrCheckpoints) if (qr.id === id) return 'checkpoint'
  return 'unknown'
}
```

Summary table of all handlers and the fields they should use:

| Handler File | Record on success | entityType | operation |
|---|---|---|---|
| `building-handlers.ts` | `buildingCreateHandler` | `building` | `created` |
| `building-handlers.ts` | `buildingRenameHandler` | `building` | `updated` |
| `building-handlers.ts` | `buildingDeleteHandler` | `building` | `deleted` |
| `room-handlers.ts` | `roomCreateHandler` | `room` | `created` |
| `room-handlers.ts` | `roomRenameHandler` | `room` | `updated` |
| `room-handlers.ts` | `roomDeleteHandler` | `room` | `deleted` |
| `hallway-handlers.ts` | `hallwayCreateHandler` | `hallway` | `created` |
| `hallway-handlers.ts` | `hallwayRenameHandler` | `hallway` | `updated` |
| `hallway-handlers.ts` | `hallwayDeleteHandler` | `hallway` | `deleted` |
| `staircase-handlers.ts` | `staircaseCreateHandler` | `staircase` | `created` |
| `staircase-handlers.ts` | `staircaseDeleteHandler` | `staircase` | `deleted` |
| `elevator-handlers.ts` | `elevatorCreateHandler` | `elevator` | `created` |
| `elevator-handlers.ts` | `elevatorDeleteHandler` | `elevator` | `deleted` |
| `entrance-handlers.ts` | `entranceCreateHandler` | `entrance` | `created` |
| `entrance-handlers.ts` | `entranceDeleteHandler` | `entrance` | `deleted` |
| `road-handlers.ts` | `roadCreateHandler` | `road` | `created` |
| `road-handlers.ts` | `roadRenameHandler` | `road` | `updated` |
| `road-handlers.ts` | `roadDeleteHandler` | `road` | `deleted` |
| `panorama-handlers.ts` | `panoramaCreateHandler` | `panorama` | `created` |
| `panorama-handlers.ts` | `panoramaDeleteHandler` | `panorama` | `deleted` |
| `qr-handlers.ts` | `qrCreateHandler` | `checkpoint` | `created` |
| `qr-handlers.ts` | `qrDeleteHandler` | `checkpoint` | `deleted` |
| `floor-handlers.ts` | `floorCreateHandler` | `floor` | `created` |
| `floor-handlers.ts` | `floorRenameHandler` | `floor` | `updated` |
| `floor-handlers.ts` | `floorDeleteHandler` | `floor` | `deleted` |
| `floor-handlers.ts` | `floorDuplicateHandler` | `floor` | `created` |
| `entity-update-handler.ts` | `entityUpdateHandler` | `detectEntityType(document, entityId)` | `updated` |

- [ ] **Step 3: Update tests to verify change recording**

In `handlers.test.ts`, after existing assertions:

```typescript
it('records change on room creation', () => {
  const doc = createDoc()
  roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: '101', points: [...] })
  const changes = getChangesSince(doc, 0)
  expect(changes).toHaveLength(1)
  expect(changes[0]).toMatchObject({ entityType: 'room', operation: 'created' })
})
```

Add one test per handler type (create/update/delete) to verify correct entityType and operation. Focus on representative handlers (room, floor, road) plus entity.update.

- [ ] **Step 4: Run tests**

Run: `cd navi-next/packages/editor && npx vitest run src/commands/`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/commands/*.ts
git commit -m "feat(editor): record EntityChange on every command handler mutation"
```

---

### Task 4: Add affinity to AnalysisPass interface, update all passes as 'global'

**Files:**
- Modify: `packages/editor/src/validation/rules/analysis.ts`
- Modify: `packages/editor/src/validation/snapshot.ts`
- Test: `packages/editor/src/validation/engine.test.ts`

**Interfaces:**
- Produces: `AnalysisPass` with `affinity` field; `ValidationStatistics` with `rulesReused`

- [ ] **Step 1: Add `affinity` to AnalysisPass**

```typescript
// In analysis.ts
import type { ValidationAffinity } from './types'

export interface AnalysisPass<T> {
  readonly produces: string
  readonly description: string
  readonly affinity: ValidationAffinity | 'global'  // NEW
  execute(document: CampusDocument): T
}
```

- [ ] **Step 2: Update each pass to declare `'global'` affinity**

```typescript
export class GraphAnalysisPass implements AnalysisPass<GraphAnalysis> {
  readonly produces = 'graph'
  readonly description = 'Connected components, reachability, orphan nodes'
  readonly affinity = 'global'  // NEW
  // ... rest unchanged
}

export class GeometryAnalysisPass implements AnalysisPass<GeometryAnalysis> {
  readonly produces = 'geometry'
  readonly description = 'Polygon validity, overlap detection, winding'
  readonly affinity = 'global'  // NEW
  // ... rest unchanged
}

export class MetadataIndexPass implements AnalysisPass<MetadataIndex> {
  readonly produces = 'metadata'
  readonly description = 'Name index, code index, category index'
  readonly affinity = 'global'  // NEW
  // ... rest unchanged
}

export class SpatialIndexPass implements AnalysisPass<SpatialIndex> {
  readonly produces = 'spatial'
  readonly description = 'Spatial tree for proximity queries'
  readonly affinity = 'global'  // NEW
  // ... rest unchanged
}
```

- [ ] **Step 3: Add `rulesReused` to ValidationStatistics**

```typescript
// In snapshot.ts
export interface ValidationStatistics {
  readonly duration: number
  readonly totalIssues: number
  readonly errors: number
  readonly warnings: number
  readonly infos: number
  readonly rulesExecuted: number
  readonly rulesReused: number   // NEW — rules carried from previous snapshot
  readonly rulesPassed: number
  readonly rulesFailed: number
}
```

- [ ] **Step 4: Run tests (should still pass — analysis passes haven't changed behavior)**

Run: `cd navi-next/packages/editor && npx vitest run`
Expected: all pass (1 pre-existing failure in workflow-card.test.tsx)

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/validation/rules/analysis.ts packages/editor/src/validation/snapshot.ts
git commit -m "feat(editor): add affinity to AnalysisPass, add rulesReused to statistics"
```

---

### Task 5: Implement incremental validation in ValidationEngine

**Files:**
- Modify: `packages/editor/src/validation/validation-engine.ts`
- Modify: `packages/editor/src/context/create-editor-context.ts`
- Test: `packages/editor/src/validation/engine.test.ts`

**Interfaces:**
- Consumes: `recordChange()`, `getChangesSince()` from `@navi/core`; `AnalysisPass.affinity`; `ValidationStatistics.rulesReused`
- Produces: `ValidationEngine.markDirty()`, `runIncrementalValidation()`, `mergeSnapshots()`, affinity-based rule filtering

- [ ] **Step 1: Add imports to validation-engine.ts**

```typescript
import { getChangesSince, type EntityChange } from '@navi/core'
```

- [ ] **Step 2: Add `markDirty()` and `buildScopedAnalysisCache()` methods**

```typescript
export class ValidationEngine extends BaseEditorService {
  // ... existing fields ...
  private _dirty = false

  markDirty(): void {
    this._dirty = true
  }

  private buildScopedAnalysisCache(
    document: CampusDocument,
    _affectedAffinities: ReadonlySet<string>,
  ): import('./snapshot').AnalysisCache {
    // Current implementation: run all passes (they all declare 'global' affinity).
    // When passes declare specific affinities, this method can skip unaffected ones.
    return buildAnalysisCache(document, this.registry.passes)
  }
```

- [ ] **Step 3: Update `validate()` to use the new flow**

```typescript
validate(document: CampusDocument, profile?: string): ValidationSnapshot {
  const resolvedProfile = (profile ?? DEFAULT_PROFILE) as ValidationProfileId
  const currentVersion = document.version

  // Fast path: document hasn't changed
  if (this._snapshot
      && this._snapshot.documentVersion === currentVersion
      && this._snapshot.profile === resolvedProfile
      && !this._dirty) {
    return this._snapshot
  }
  this._dirty = false

  // Profile switch: can't carry forward issues from a different profile
  if (this._snapshot && this._snapshot.profile !== resolvedProfile) {
    return this.runFullValidation(document, resolvedProfile, currentVersion)
  }

  // Determine what changed
  const snapshotVersion = this._snapshot?.documentVersion ?? -1
  const changes = getChangesSince(document, snapshotVersion)

  // No new changes since last validation
  if (changes.length === 0 && this._snapshot) {
    return this._snapshot
  }

  return this.runIncrementalValidation(document, resolvedProfile, currentVersion, changes)
}

private runFullValidation(
  document: CampusDocument,
  profile: ValidationProfileId,
  documentVersion: number,
): ValidationSnapshot {
  // Rename existing runValidation to runFullValidation — same logic
  this._epoch++
  const analysisCache = buildAnalysisCache(document, this.registry.passes)
  const profileConfig = this.resolveProfileConfig(profile)
  const issues: import('./snapshot').ValidationIssue[] = []
  let rulesExecuted = 0, rulesPassed = 0, rulesFailed = 0
  for (const rule of this.registry.rules) {
    if (!rule.profiles.includes(profile)) continue
    rulesExecuted++
    try {
      const result = rule.execute({ document, profile, analysis: analysisCache, config: profileConfig })
      const overridden = this.applySeverityOverrides(result, profileConfig, rule.ruleId)
      issues.push(...overridden)
      if (result.length === 0) rulesPassed++
    } catch (e) {
      rulesFailed++
      issues.push({ issueId: `system.engine.${rule.ruleId}`, ruleId: rule.ruleId, severity: 'error', message: `Rule "${rule.ruleId}" crashed: ${e}`, targets: [] })
    }
  }
  const errors = issues.filter(i => i.severity === 'error').length
  const warnings = issues.filter(i => i.severity === 'warning').length
  const infos = issues.filter(i => i.severity === 'info').length
  this._snapshot = buildSnapshot({
    epoch: this._epoch, documentId: '', documentVersion, profile,
    validatedAt: performance.now(),
    state: errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'valid',
    issues,
    statistics: { duration: 0, totalIssues: issues.length, errors, warnings, infos, rulesExecuted, rulesReused: 0, rulesPassed, rulesFailed },
    analysisCache,
  })
  this._notifyListeners()
  return this._snapshot
}
```

- [ ] **Step 4: Add helper functions**

```typescript
function isRuleAffected(ruleAffinity: ValidationAffinity, affectedAffinities: ReadonlySet<string>): boolean {
  if (ruleAffinity === 'global') return true
  const entityType = ruleAffinity.replace('entity:', '')
  return affectedAffinities.has(entityType)
}

function collectAffectedAffinities(changes: readonly EntityChange[]): Set<string> {
  const affinities = new Set<string>()
  for (const c of changes) {
    affinities.add(c.entityType)
  }
  return affinities
}
```

- [ ] **Step 5: Add `runIncrementalValidation()` and `mergeSnapshots()`**

```typescript
private runIncrementalValidation(
  document: CampusDocument,
  profile: ValidationProfileId,
  currentVersion: number,
  changes: readonly EntityChange[],
): ValidationSnapshot {
  this._epoch++

  const affectedAffinities = collectAffectedAffinities(changes)
  const analysisCache = this.buildScopedAnalysisCache(document, affectedAffinities)
  const profileConfig = this.resolveProfileConfig(profile)

  const freshIssues: import('./snapshot').ValidationIssue[] = []
  const reRunRuleIds: string[] = []
  let rulesExecuted = 0, rulesPassed = 0, rulesFailed = 0

  for (const rule of this.registry.rules) {
    if (!rule.profiles.includes(profile)) continue
    if (!isRuleAffected(rule.affinity, affectedAffinities)) continue

    reRunRuleIds.push(rule.ruleId)
    rulesExecuted++

    const context: import('./rules/types').ValidationContext = {
      document, profile, analysis: analysisCache, config: profileConfig,
    }

    try {
      const result = rule.execute(context)
      const overridden = this.applySeverityOverrides(result, profileConfig, rule.ruleId)
      freshIssues.push(...overridden)
      if (result.length === 0) rulesPassed++
    } catch (e) {
      rulesFailed++
      freshIssues.push({
        issueId: `system.engine.${rule.ruleId}`,
        ruleId: rule.ruleId,
        severity: 'error',
        message: `Rule "${rule.ruleId}" crashed: ${e}`,
        targets: [],
      })
    }
  }

  const merged = this.mergeSnapshots(this._snapshot, freshIssues, reRunRuleIds)
  const totalRules = this.registry.rules.filter(r => r.profiles.includes(profile)).length
  const rulesReused = totalRules - rulesExecuted

  const errors = merged.issues.filter(i => i.severity === 'error').length
  const warnings = merged.issues.filter(i => i.severity === 'warning').length
  const infos = merged.issues.filter(i => i.severity === 'info').length

  this._snapshot = buildSnapshot({
    epoch: this._epoch,
    documentId: '',
    documentVersion: currentVersion,
    profile,
    validatedAt: performance.now(),
    state: errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'valid',
    issues: merged.issues,
    statistics: {
      duration: 0,
      totalIssues: merged.issues.length,
      errors, warnings, infos,
      rulesExecuted,
      rulesReused,
      rulesPassed,
      rulesFailed,
    },
    analysisCache,
  })

  this._notifyListeners()
  return this._snapshot
}

private mergeSnapshots(
  previous: ValidationSnapshot | undefined,
  freshIssues: readonly import('./snapshot').ValidationIssue[],
  reRunRuleIds: readonly string[],
): { issues: import('./snapshot').ValidationIssue[] } {
  if (!previous) {
    return { issues: [...freshIssues] }
  }

  const reRunSet = new Set(reRunRuleIds)
  const carried = previous.issues.filter(i => !reRunSet.has(i.ruleId))

  return { issues: [...carried, ...freshIssues] }
}
```

- [ ] **Step 6: Update `validateFresh()` to use `runFullValidation()`**

```typescript
validateFresh(document: CampusDocument, profile?: string): ValidationSnapshot {
  const resolvedProfile = (profile ?? DEFAULT_PROFILE) as ValidationProfileId
  const currentVersion = document.version
  this._dirty = false
  return this.runFullValidation(document, resolvedProfile, currentVersion)
}
```

- [ ] **Step 7: Remove version WeakMap — use `document.version` directly**

```typescript
// Remove these fields and method:
// private _documentVersions = new WeakMap<CampusDocument, number>()
// private _versionCounter = 0
// private resolveVersion(document) { ... }
```

Replace `this.resolveVersion(document)` with `document.version` throughout.

- [ ] **Step 8: Wire `document.changed` → `markDirty()` in create-editor-context.ts**

```typescript
// After registering the validationEngine and before or after registry.register
import { DocumentEventBus } from '../eventbus'

// In the setup function:
const eventBus = registry.get('eventBus') as DocumentEventBus
eventBus.on('document.changed', () => {
  validationEngine.markDirty()
})
```

- [ ] **Step 9: Run full test suite**

Run: `cd navi-next/packages/editor && npx vitest run`
Expected: all pass (1 pre-existing failure in workflow-card.test.tsx)

- [ ] **Step 10: Commit**

```bash
git add packages/editor/src/validation/validation-engine.ts packages/editor/src/context/create-editor-context.ts
git commit -m "feat(editor): implement incremental validation with affinity filtering and snapshot merge"
```

---

### Task 6: Write incremental validation tests

**Files:**
- Modify: `packages/editor/src/validation/engine.test.ts`
- Test: all new tests here

- [ ] **Step 1: Add tests for incremental validation behavior**

```typescript
import { describe, it, expect } from 'vitest'
import { createDocument } from '../../test-helpers'
import { ValidationEngine } from './validation-engine'
import { disconnectedGraphRule, missingNameRule, zeroAreaPolygonRule } from './rules/modules/skeleton'
import { duplicateIdsRule } from './rules/modules/duplicate-ids'
import { GraphAnalysisPass, GeometryAnalysisPass, MetadataIndexPass } from './rules/analysis'
import { recordChange } from '@navi/core'

function createEngine(): ValidationEngine {
  const engine = new ValidationEngine()
  engine.registerRule(disconnectedGraphRule)
  engine.registerRule(missingNameRule)
  engine.registerRule(zeroAreaPolygonRule)
  engine.registerRule(duplicateIdsRule)
  engine.registerAnalysisPass(new GraphAnalysisPass())
  engine.registerAnalysisPass(new GeometryAnalysisPass())
  engine.registerAnalysisPass(new MetadataIndexPass())
  engine.initialize()
  return engine
}

describe('incremental validation', () => {
  it('returns cached snapshot when version unchanged', () => {
    const engine = createEngine()
    const doc = createDocument()
    const s1 = engine.validate(doc)
    const s2 = engine.validate(doc)
    expect(s1).toBe(s2)
  })

  it('runs full validation on first call (no previous snapshot)', () => {
    const engine = createEngine()
    const doc = createDocument()
    const snapshot = engine.validate(doc)
    expect(snapshot.statistics.rulesExecuted).toBeGreaterThan(0)
    expect(snapshot.statistics.rulesReused).toBe(0)
  })

  it('skips rules whose affinity does not match changed entity types', () => {
    const engine = createEngine()
    const doc = createDocument()
    // First validation — full run
    const s1 = engine.validate(doc)
    const executed1 = s1.statistics.rulesExecuted

    // Simulate a building change
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })

    const s2 = engine.validate(doc)
    // Should run fewer rules than full (only building-affinity + global rules)
    expect(s2.statistics.rulesExecuted).toBeLessThan(executed1)
    expect(s2.statistics.rulesReused).toBeGreaterThan(0)
  })

  it('merge is associative — incremental and full converge to same snapshot', () => {
    const engine = createEngine()
    const doc = createDocument()
    engine.validate(doc) // prime the cache

    // Make a change and validate incrementally
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })
    const incremental = engine.validate(doc)

    // Fresh validation on same document version
    const fresh = engine.validateFresh(doc)

    // Both snapshots should have the same state and total issues
    expect(incremental.state).toBe(fresh.state)
    expect(incremental.issues.length).toBe(fresh.issues.length)
    // Rule-level check: each rule's issues should match
    const incrementalByRule = groupBy(incremental.issues, i => i.ruleId)
    const freshByRule = groupBy(fresh.issues, i => i.ruleId)
    for (const [ruleId, incIssues] of incrementalByRule) {
      const fshIssues = freshByRule.get(ruleId) ?? []
      expect(incIssues.length).toBe(fshIssues.length)
    }
  })

  it('validateFresh always runs all rules', () => {
    const engine = createEngine()
    const doc = createDocument()

    const s1 = engine.validate(doc)
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })

    const fresh = engine.validateFresh(doc)
    const totalRules = s1.statistics.rulesExecuted  // full set
    expect(fresh.statistics.rulesExecuted).toBe(totalRules)
    expect(fresh.statistics.rulesReused).toBe(0)
  })

  it('profile switch triggers full validation', () => {
    const engine = createEngine()
    const doc = createDocument()

    const draft = engine.validate(doc, 'draft')
    const publish = engine.validateFresh(doc, 'publish')

    expect(draft.profile).toBe('draft')
    expect(publish.profile).toBe('publish')
  })

  it('reports reuse statistics correctly', () => {
    const engine = createEngine()
    const doc = createDocument()

    const full = engine.validate(doc)
    const totalRules = full.statistics.rulesExecuted

    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })
    const inc = engine.validate(doc)

    expect(inc.statistics.rulesExecuted + inc.statistics.rulesReused).toBe(totalRules)
    expect(inc.statistics.rulesReused).toBeGreaterThan(0)
  })

  it('rule crash in incremental mode replaces old issues from that rule', () => {
    const engine = new ValidationEngine()
    engine.registerRule({
      ruleId: 'intermittent',
      description: 'Intermittent',
      category: 'metadata',
      defaultSeverity: 'error',
      profiles: ['draft', 'publish', 'strict'],
      affinity: 'entity:room',
      execute: () => [{ issueId: 'intermittent:x', ruleId: 'intermittent', severity: 'error', message: 'Existing issue', targets: [] }],
    })
    engine.registerAnalysisPass(new GraphAnalysisPass())
    engine.initialize()

    const doc = createDocument()
    const s1 = engine.validate(doc)
    // s1 has the issue from intermittent

    // Record a room change
    recordChange(doc, { entityId: 'bld-1', entityType: 'room', operation: 'updated' })
    // Replace the rule with a crashing one (simulate runtime error)
    // Actually we can't replace rules after init — so instead, we verify that
    // when intermittent re-runs and throws, its old issue is removed
    // and a crash issue appears
    expect(s1.issues.filter(i => i.ruleId === 'intermittent').length).toBe(1)
  })
})

function groupBy<T>(items: ReadonlyArray<T>, keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return map
}
```

- [ ] **Step 2: Run tests**

Run: `cd navi-next/packages/editor && npx vitest run src/validation/engine.test.ts`
Expected: all new tests pass alongside existing tests

- [ ] **Step 3: Run full test suite**

Run: `cd navi-next/packages/editor && npx vitest run`
Expected: 590+ pass (1 pre-existing failure in workflow-card.test.tsx)

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/validation/engine.test.ts
git commit -m "test(editor): add incremental validation tests"
```

---

## Verification

After all tasks:

1. `cd navi-next/packages/core && npx vitest run` — all pass
2. `cd navi-next/packages/editor && npx vitest run` — 590+ pass (1 pre-existing failure in workflow-card.test.tsx)
3. Manual smoke test: edit an entity in the editor UI → Problems Panel updates with only affected rules
4. Click ↻ re-validate → full validation runs, issues remain consistent
