# Incremental Validation

**Date**: 2026-07-13
**Status**: Draft
**Phase**: 6
**Depends on**: Phase 5 (Auto Fix Infrastructure)

---

## Overview

Currently `ValidationEngine.validate()` runs every rule and every analysis pass on every call — a full-campus scan regardless of what changed. With the current 8 rules and 4 analysis passes this is fast, but as the campus grows and more rules are added, full scans become wasteful.

This spec adds incremental validation: the engine reacts to **what actually changed** and runs only the rules (and optionally, analysis passes) whose `affinity` matches the changed entity types. Unaffected rules carry their issues forward from the previous snapshot.

### Target flow

```
Command → mutate CampusDocument → recordChange() → emit event (invalidation signal only)

validate()
    ↓
document.version === snapshot.version? → return cached (fast path)
    ↓
changes = document.getChangesSince(snapshot.version)
    ↓
affectedAffinities = unique entityTypes from changes
    ↓
Run affected AnalysisPasses (by affinity — current passes are 'global')
    ↓
Run affected ValidationRules (by affinity — skip if no match)
    ↓
Merge: remove old issues from re-run rules, append fresh issues
    ↓
Return merged snapshot
```

---

## 1. Change Journal on CampusDocument

### EntityChange type

```typescript
interface EntityChange {
  readonly entityId: string
  readonly entityType: string
  readonly operation: 'created' | 'updated' | 'deleted'
}
```

### CampusDocument additions

```typescript
interface CampusDocument {
  // existing fields...

  /** Monotonic version counter, bumped on every recorded change. */
  version: number

  /**
   * Runtime-only change journal. Not serialized.
   * Populated during editing sessions, discarded on save/load.
   */
  _changeJournal: EntityChange[]

  /** Record a change, bump the document version. */
  recordChange(change: EntityChange): void

  /**
   * Return all changes recorded since the given version.
   * Non-destructive — multiple callers can query independently.
   * Returns empty array if version >= current document version.
   */
  getChangesSince(version: number): readonly EntityChange[]
}
```

### Semantics

- `recordChange()` appends the change and increments `version`
- `getChangesSince(v)` filters `_changeJournal` by index — entries are ordered, so it returns journal entries from position `v` onward (where position tracks the version at which each change was recorded)
- The journal is append-only, never consumed
- Journal pruning is a future optimization (e.g., discard entries after all consumers have validated past them)
- `version` starts at 0 for a fresh document, increments monotonically through the session
- On save/load, `version` is preserved (the loaded document starts at whatever version was saved), but `_changeJournal` is empty — changes from a different session cannot be replayed

---

## 2. Command Integration

### Commands already know what changed

Every `CommandHandler.execute()` receives the document and the entity it operates on. Handlers already know `entityId`, `entityType`, and the operation (create/update/delete).

Each handler calls `document.recordChange()` before returning:

```typescript
// In entity-update-handler.ts
execute(document, payload): MutationResult {
  const entityId = payload.entityId
  // ... apply changes ...
  document.recordChange({ entityId, entityType: 'room', operation: 'updated' })
  return { success: true, entityId, data: { oldValues } }
}
```

### Existing handlers to update

All registered command handlers that mutate the document (create, update, delete across all entity types):

| Handler | entityType | operation |
|---------|-----------|-----------|
| `entity.update` | dynamic (from payload) | `updated` |
| `entity.create` | dynamic | `created` |
| `entity.delete` | dynamic | `deleted` |
| `floor.create` | `floor` | `created` |
| `floor.rename` | `floor` | `updated` |
| `floor.delete` | `floor` | `deleted` |
| `floor.duplicate` | `floor` | `created` |
| `road.*` | `road` | per handler |
| `building.*` | `building` | per handler |

### Inverse (undo) commands

Inverse commands also mutate the document. They record the inverse change with the correct `operation` and `entityType`. The validation engine treats all changes identically regardless of origin.

---

## 3. Incremental Execution Pipeline

### ValidationEngine.validate() — new flow

```typescript
validate(document: CampusDocument, profile?: string): ValidationSnapshot {
  const resolvedProfile = resolveProfile(profile)
  const currentVersion = document.version

  // Fast path: document hasn't changed
  if (this._snapshot
      && this._snapshot.documentVersion === currentVersion
      && this._snapshot.profile === resolvedProfile) {
    return this._snapshot
  }

  // Profile switch: can't carry forward issues from a different profile
  if (this._snapshot && this._snapshot.profile !== resolvedProfile) {
    return this.runFullValidation(document, resolvedProfile, currentVersion)
  }

  // Determine what changed
  const snapshotVersion = this._snapshot?.documentVersion ?? -1
  const changes = document.getChangesSince(snapshotVersion)

  // No new changes since last validation
  if (changes.length === 0 && this._snapshot) {
    return this._snapshot
  }

  return this.runIncrementalValidation(document, resolvedProfile, currentVersion, changes)
}
```

### The incremental path

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

  const freshIssues: ValidationIssue[] = []
  const reRunRuleIds: string[] = []
  let rulesExecuted = 0, rulesPassed = 0, rulesFailed = 0

  for (const rule of this.registry.rules) {
    if (!rule.profiles.includes(profile)) continue

    // Skip rules whose affinity doesn't match any changed entity type
    if (!isRuleAffected(rule.affinity, affectedAffinities)) continue

    reRunRuleIds.push(rule.ruleId)
    rulesExecuted++

    const context: ValidationContext = {
      document, profile, analysis: analysisCache, config: profileConfig,
    }

    try {
      const result = rule.execute(context)
      const overridden = this.applySeverityOverrides(result, profileConfig, rule.ruleId)
      freshIssues.push(...overridden)
      if (result.length === 0) rulesPassed++
    } catch (e) {
      rulesFailed++
      freshIssues.push(systemCrashIssue(rule.ruleId, e))
    }
  }

  const merged = this.mergeSnapshots(this._snapshot, freshIssues, reRunRuleIds)
  const stats = this.computeMergedStatistics(merged.issues, rulesExecuted, rulesPassed, rulesFailed)

  this._snapshot = buildSnapshot({
    epoch: this._epoch,
    documentId: '',
    documentVersion: currentVersion,
    profile,
    validatedAt: performance.now(),
    state: computeState(merged.issues),
    issues: merged.issues,
    statistics: stats,
    analysisCache,
  })

  this._notifyListeners()
  return this._snapshot
}
```

### Helper: isRuleAffected

```typescript
function isRuleAffected(
  ruleAffinity: ValidationAffinity,
  affectedAffinities: ReadonlySet<string>,
): boolean {
  if (ruleAffinity === 'global') return true
  // e.g., 'entity:room' → extract 'room' and check if in affected set
  const entityType = ruleAffinity.replace('entity:', '')
  return affectedAffinities.has(entityType)
}
```

---

## 4. Analysis Pass Staleness

### Designer's note

Analysis passes participate in the same affinity system as rules.

```typescript
interface AnalysisPass<T> {
  readonly produces: string
  readonly description: string
  readonly affinity: ValidationAffinity | 'global'  // NEW
  execute(document: CampusDocument): T
}
```

### Current passes

All built-in passes declare `'global'` affinity and therefore re-run every validation:

| Pass | Affinity | Rationale |
|------|----------|-----------|
| `GraphAnalysisPass` | `'global'` | Counts nodes/edges across all entity types |
| `GeometryAnalysisPass` | `'global'` | Iterates all rooms for zero-area checks |
| `MetadataIndexPass` | `'global'` | Indexes all entity names across types |
| `SpatialIndexPass` | `'global'` | Stub — always returns `{ isBuilt: false }` |

### Future optimization

When a pass's affinity is more specific (e.g., `'entity:room'`), it only re-runs when that entity type changed. The engine selects passes the same way it selects rules:

```text
affectedAffinities → filter passes by affinity → run matching passes → cache result
```

This is not needed today but the engine supports it architecturally.

---

## 5. Snapshot Merging

### Invariant

> **Every `ValidationIssue` belongs to exactly one `ValidationRule` (`issue.ruleId`). A validation cycle never edits individual issues. It replaces the complete output of every rule that executed.**

### Merge algorithm

```typescript
function mergeSnapshots(
  previous: ValidationSnapshot | undefined,
  freshIssues: readonly ValidationIssue[],
  reRunRuleIds: readonly string[],
): { issues: ValidationIssue[] } {
  if (!previous) {
    // First validation — nothing to merge
    return { issues: [...freshIssues] }
  }

  // 1. Drop all issues from rules that just re-ran
  const reRunSet = new Set(reRunRuleIds)
  const carried = previous.issues.filter(i => !reRunSet.has(i.ruleId))

  // 2. Append fresh issues from re-run rules
  return { issues: [...carried, ...freshIssues] }
}
```

### Associativity guarantee

Merge is associative with respect to unaffected rules:

```
Rule A re-runs  →  Rule B re-runs  →  same snapshot as  →  Rule A+B re-run together
```

This guarantees incremental validation and full validation converge to identical snapshots for the same document version.

### Edge cases

| Scenario | Behavior |
|----------|----------|
| No previous snapshot | Full validation, no merge (identity) |
| Profile switch (e.g., draft → publish) | Full validation — can't carry issues from a different profile |
| All rules skipped (version unchanged) | Return cached snapshot (fast path) |
| All rules re-run | Effectively full validation — merge is a no-op |
| Rule crashes | Crash issue replaces all prior issues from that rule |
| `validateFresh()` called | Skips incremental path, runs all rules (full validation) |
| First validation after journal prune | `getChangesSince` returns full journal — all rules re-run |

---

## 6. Statistics

**Invariant:** Execution statistics describe what the engine did this cycle. Issue statistics describe the resulting snapshot.

```typescript
interface ValidationStatistics {
  readonly duration: number
  readonly totalIssues: number
  readonly errors: number
  readonly warnings: number
  readonly infos: number

  // Execution stats (this cycle)
  readonly rulesExecuted: number    // rules that ran this cycle
  readonly rulesReused: number      // rules carried from previous snapshot
  readonly rulesPassed: number      // executed rules that produced zero issues this cycle
  readonly rulesFailed: number      // executed rules that crashed this cycle
}
```

`rulesExecuted + rulesReused = total registered rules (filtered by profile)`.

---

## 7. Event-Driven Invalidation

Events are used for **notification only**, never as a source of truth for what changed.

### Current events

The `CommandDispatcher` already emits:

- `entity.created` / `entity.updated` / `entity.deleted` (per command)
- `document.changed` (after every successful command)

### New: ValidationEngine.markDirty()

```typescript
class ValidationEngine {
  private _dirty = false

  markDirty(): void {
    this._dirty = true
  }

  validate(document, profile): ValidationSnapshot {
    // If dirty flag is set, always check document version
    if (this._dirty) {
      this._dirty = false
      // Continue to change detection flow...
    }
    // ... rest of validate()
  }
}
```

### Wiring

In `create-editor-context.ts` or equivalent setup:

```typescript
eventBus.on('document.changed', () => {
  validationEngine.markDirty()
})
```

This triggers the engine to check `document.version` against the snapshot on the next `validate()` call. The engine queries the document for actual changes — the event only says "something happened."

---

## 8. Implementation Plan

### Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Add `EntityChange` type, `version`, `_changeJournal`, `recordChange()`, `getChangesSince()` to CampusDocument | `packages/core/src/types/document.ts` |
| 2 | Add `recordChange()` calls to all command handlers (create/update/delete) | `packages/editor/src/commands/*.ts` |
| 3 | Add `affinity` to `AnalysisPass` interface + update all passes to declare `'global'` | `packages/editor/src/validation/rules/analysis.ts` |
| 4 | Implement `isRuleAffected()`, `collectAffectedAffinities()` helpers | New file or within `validation-engine.ts` |
| 5 | Implement `runIncrementalValidation()` in ValidationEngine | `packages/editor/src/validation/validation-engine.ts` |
| 6 | Implement `mergeSnapshots()` + `computeMergedStatistics()` | `validation-engine.ts` |
| 7 | Wire `document.changed` event → `ValidationEngine.markDirty()` | `packages/editor/src/context/create-editor-context.ts` |
| 8 | Remove version WeakMap from ValidationEngine (now uses document.version) | `validation-engine.ts` |
| 9 | Tests: incremental validation, merge associativity, edge cases | `validation/engine.test.ts` |
| 10 | Full test suite: verify 0 regressions | — |

### Acceptance criteria

1. Engine returns cached snapshot when document version unchanged
2. Engine runs only rules whose affinity matches changed entity types
3. Engine merges fresh rule output with carried-forward issues
4. `validateFresh()` runs all rules (bypasses incremental path)
5. Merge is deterministic — same document version always produces same snapshot
6. Statistics correctly distinguish executed vs reused rules
7. All existing 590+ tests pass
8. 15+ new tests for incremental validation paths

---

## 9. Future Considerations

### Not in scope for Phase 6

- Field-level diffs (e.g., "room.name changed" vs "room changed")
- Journal pruning (cleanup old entries)
- Concurrent validation consumers (multiple profiles validating independently)
- Analysis pass granularity (beyond 'global' affinity)
- Live collaboration / multi-user change journal

These are all natural extensions of the current architecture and can be added incrementally without redesign.
