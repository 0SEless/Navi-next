---
phase: code-review
reviewed: 2026-06-26T12:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - src/store/graph-store.ts
  - src/store/studio-store.ts
  - src/store/campus-map-store.ts
  - src/store/ui-store.ts
  - src/hooks/useAuth.ts
  - src/hooks/useGeolocation.ts
  - src/lib/mock-auth.ts
  - src/lib/supabase.ts
  - src/lib/supabase-client.ts
  - src/lib/supabase-server.ts
  - src/lib/db-schema.ts
findings:
  critical: 7
  warning: 9
  info: 6
  total: 22
status: issues_found
---

# Code Review Report

**Reviewed:** 2026-06-26T12:00:00Z
**Depth:** deep (cross-file analysis)
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Cross-file deep review of 11 source files revealed significant type-safety issues stemming from a mismatch between the `NavNode` type definition and its usages across the engine layer, data serialization inconsistencies between `toJSON()` and `GraphSnapshot`, insecure raw SQL construction, a client-incompatible Node.js API (`Buffer`) used without guards, silent error swallowing patterns, and authentication/authorization gaps on API calls. Several findings constitute HIGH-severity correctness or security risks.

---

## Critical Issues

### CR-01: NavNode type definition diverged from engine implementations — required fields missing, wrong property names, invalid type values

**Files:** `src/types/nav-types.ts:7`, `src/engine/component-compiler.ts:83-91`, `src/engine/directory.ts:22`, `src/engine/a-star.ts:40`, `src/engine/graph-validator.ts:120`

**Issue:** The `NavNode` interface (nav-types.ts:7-17) defines:
- `label: string` (not `name`)
- type union: `'room' | 'walkway' | 'stair' | 'elevator' | 'entrance' | 'qr_marker'`
- `campusId: string` (required)

But every NavNode object created in the engine layer uses the wrong field names and values:
- **`component-compiler.ts:85`**: assigns `name: ...` instead of `label` — NavNode has no `name` property
- **`component-compiler.ts:83-91`**: missing required `campusId` property
- **`component-compiler.ts:86`**: assigns `type: 'corner'` which is not in the NavNode type union
- **`component-compiler.ts:158`**, **`:167`**: assigns `type: 'staircase'` not in union
- **`component-compiler.ts:232`**, **`:256`**: assigns `type: 'intersection'`, `'building_entrance'` not in union
- **`component-compiler.ts:260-261`**: assigns non-existent `hasQr`, `hasPanorama` properties
- **`directory.ts:22,28`**, **`a-star.ts:40`**: read `n.name` which doesn't exist on NavNode
- **`graph-validator.ts:120,128`**: reads `n.hasQr`, `n.hasPanorama` which don't exist on NavNode
- **`db-schema.ts:93-96`**: reads `n.hasQr`, `n.hasPanorama`, `n.svgOffset` which don't exist on NavNode

With `strict: true` in tsconfig.json, these would be TypeScript compile errors. The code either has not been type-checked or uses type escapes. This indicates a fundamental type divergence — either NavNode needs to be updated to include the legacy fields, or all engine code must be migrated.

**Fix:** Align the NavNode type with actual usage, or migrate engine code to use the correct NavNode type. At minimum, NavNode needs these additional fields:
```typescript
export interface NavNode {
  id: string;
  label: string;
  name?: string;  // alias for label, used by engine layer
  position: LatLng;
  floor: number;
  buildingId: string;
  campusId: string;
  type: NodeType;  // use the wider legacy union
  componentId?: string;
  hasQr?: boolean;
  hasPanorama?: boolean;
  svgOffset?: { x: number; y: number };
  metadata?: Record<string, string>;
}
```

---

### CR-02: Buffer usage in mock-auth.ts crashes client-side (ReferenceError)

**File:** `src/lib/mock-auth.ts:19,24`

**Issue:** `encodeMockSession` and `decodeMockSession` use `Buffer.from()` and `Buffer.toString()`, which is a Node.js global. In browser/Edge Runtime contexts (Next.js client components, middleware), `Buffer` is not guaranteed to be available and will throw `ReferenceError: Buffer is not defined`. The `isMockAuthEnabled` function reads `process.env.NEXT_PUBLIC_MOCK_AUTH` which is a client-side variable, indicating this code IS intended to run in the browser.

**Fix:** Use browser-compatible base64 encoding/decoding:
```typescript
export function encodeMockSession(user: MockUser): string {
  return btoa(JSON.stringify(user));
}

export function decodeMockSession(raw: string): MockUser | null {
  try {
    return JSON.parse(atob(raw));
  } catch {
    return null;
  }
}
```

If Node.js Buffer is required for server-only use, wrap with:
```typescript
if (typeof window !== 'undefined') {
  // browser path using btoa/atob
} else {
  // Node path using Buffer
}
```

---

### CR-03: SQL injection vulnerability in raw SQL string construction

**File:** `src/lib/db-schema.ts:39-58`

**Issue:** Functions `toPoint`, `toLineString`, and `toPolygon` concatenate user-provided values directly into SQL strings via string interpolation:

```typescript
// line 39-41
export function toPoint(lat: number, lng: number): string {
  return `ST_MakePoint(${lng}, ${lat})::geography`
}
```

Although `lat` and `lng` are typed as `number`, JavaScript `number` values can be `NaN`, `Infinity`, or very large/small values that could produce malformed SQL. Moreover, if these functions are ever called with non-sanitized inputs (e.g., from user uploads or API parameters), they'd enable SQL injection. The same issue exists in `toLineString` (line 51) and `toPolygon` (line 58).

**Fix:** Use parameterized queries or a query builder (e.g., Knex, Supabase JS client) instead of raw SQL strings. If raw SQL is unavoidable, validate numeric inputs:
```typescript
export function toPoint(lat: number, lng: number): string {
  if (!isFinite(lat) || !isFinite(lng) || 
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`);
  }
  return `ST_MakePoint(${lng}, ${lat})::geography`
}
```

---

### CR-04: Missing authentication credentials on all Supabase API calls

**Files:** `src/store/graph-store.ts:224`, `src/store/campus-map-store.ts:124,136,159`, `src/lib/supabase.ts:6`, `src/lib/supabase-client.ts:4-7`, `src/lib/supabase-server.ts:6-8`

**Issue:** All API calls in `graph-store.ts` and `campus-map-store.ts` use `fetch('/api/graph', ...)` and `fetch('/api/campus-maps', ...)` without any authentication headers, cookies, or credentials. The Supabase client configurations use only `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the anonymous/anonymous key), which provides no authenticated identity for multi-tenant data isolation. The `supabase.ts` client at line 6 calls `createClient(supabaseUrl, supabaseKey)` without passing any auth token. This means:

1. No server-side request validation can determine which user/campus the request belongs to
2. Any client knowing the API route can read/write graph data
3. The `syncToSupabase`/`fetchFromSupabase` operations have no authorization context

While the anon key is intended for public Row-Level Security (RLS), there is no evidence of session tokens being attached to the Supabase client.

**Fix:** When making API calls, include authentication headers or credentials:
```typescript
// graph-store.ts syncToSupabase
const res = await fetch('/api/graph', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',  // sends cookies
  body: JSON.stringify(snapshot),
})
```

For Supabase direct client usage, attach the session:
```typescript
const { data: { session } } = await supabase.auth.getSession()
const client = createClient(supabaseUrl, supabaseKey, {
  global: { headers: { Authorization: `Bearer ${session?.access_token}` } }
})
```

---

### CR-05: Null/undefined spread causes runtime crash in fetchFromSupabase

**File:** `src/store/campus-map-store.ts:149-150`

**Issue:**
```typescript
if (m.landmarkTypes) landmarkTypes.push(...m.landmarkTypes)
if (m.landmarkInstances) landmarkInstances.push(...m.landmarkInstances)
```

The guard `if (m.landmarkTypes)` passes for both `undefined` and `null`. But if `m.landmarkTypes` is `null`, then `...m.landmarkTypes` will throw `TypeError: Cannot spread non-iterable value` at runtime because `null` is not iterable. The spread operator on arrays uses the `[Symbol.iterator]()` protocol, and `null` has no iterator.

**Fix:** Use explicit `null`-safe checks:
```typescript
if (Array.isArray(m.landmarkTypes)) landmarkTypes.push(...m.landmarkTypes)
if (Array.isArray(m.landmarkInstances)) landmarkInstances.push(...m.landmarkInstances)
```

---

### CR-06: GraphSnapshot type mismatch — toJSON() returns incompatible shape with missing required fields and extra fields

**Files:** `src/types/nav-types.ts:56-65`, `src/engine/graph.ts:261-272`

**Issue:** The `GraphSnapshot` interface requires:
- `id: string` (required)
- `updatedAt: string` (required)
- `components: MapComponent[]`

But `Graph.toJSON()` (graph.ts:261-272) returns:
- MISSING `id` — no `id` property at all
- Uses `exportedAt` instead of `updatedAt` — wrong field name
- Contains `traces: TracePath[]` which doesn't exist on GraphSnapshot
- `components` is typed as `Component[]` (from the getter) not `MapComponent[]` — incompatible types

This means any code that calls `graph.toJSON()` and uses the result as a `GraphSnapshot` (e.g., `graph-store.ts:207` where `get().graph.toJSON()` is called and serialized to localStorage) will produce data that cannot be deserialized correctly by `Graph.fromJSON(snapshot)` because:
- `fromJSON` accesses `snapshot.components ?? []` and `snapshot.traces ?? []`
- But the serialized data won't have `id` or `updatedAt` when round-tripped

**Fix:** Update `GraphSnapshot` to match the actual serialized shape, or fix `toJSON()`:
```typescript
// Option A: Fix toJSON to match GraphSnapshot
toJSON(): GraphSnapshot {
  return {
    id: this._id ?? 'graph-default',
    campusId: 'asu-ibajay',
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    buildings: this.buildings,
    components: this.components,  // but components returns Component[], not MapComponent[]
    nodes: this.nodes,
    edges: this.edges,
  }
}

// Option B: Add traces and exportedAt to GraphSnapshot
export interface GraphSnapshot {
  // ...existing fields...
  traces?: TracePath[]
  exportedAt?: string
}
```

---

### CR-07: Building type fields inconsistent between type definition and DB serialization

**Files:** `src/types/nav-types.ts:29-37`, `src/lib/db-schema.ts:62-80`

**Issue:** The `Building` interface defines:
- `floors: number[]` (array of floor numbers)
- NO `code`, `description`, `color`, `floorPlanUrl` properties

But `buildingToRow` (db-schema.ts:62-80) accesses:
- `b.code ?? null` — property does not exist on Building
- `b.description ?? ""` — property does not exist on Building
- `b.color ?? "#64748B"` — property does not exist on Building
- `(b as unknown as Record<string, unknown>).floorPlanUrl` — type escape for non-existent property
- `b.floors ?? 1` — treats floors as a single number, when it's `number[]`

This means:
1. `b.floors ?? 1` compiles (it's a `number[]` that defaults to a `number`) — type mismatch!
2. The floor type error alone means all floor-related DB queries will be incorrect
3. The explicit type escape `b as unknown as Record<string, unknown>` bypasses all type safety

**Fix:** Update the `Building` type to include all serialized fields, and fix the `floors` type:
```typescript
export interface Building {
  id: string;
  name: string;
  campusId: string;
  code?: string;
  description?: string;
  color?: string;
  floors: number;  // total floor count, or number[] if per-floor data
  floorPlanUrl?: string;
  footprint: LatLng[];
  baseElevation: number;
  height: number;
  center?: LatLng;
  outline?: LatLng[];
}
```

---

## Warnings

### WR-01: load() function implemented but absent from GraphState interface

**File:** `src/store/graph-store.ts:172-185` / `src/store/graph-store.ts:11-45`

**Issue:** The `load()` function is defined at line 172 but is NOT declared in the `GraphState` interface. Consumers using `useGraphStore.getState().load()` will get a TypeScript error (method doesn't exist on the type). With `strict: true`, the object literal should be flagged for excess property `load`. Either the interface is incomplete, or `load` should be exposed properly.

**Fix:** Add `load` to the `GraphState` interface:
```typescript
interface GraphState {
  // ... existing methods ...
  load: () => void
  loadMapData: (mapId: string) => void
  // ...
}
```

---

### WR-02: Identical ternary branches in setTraceActive

**File:** `src/store/studio-store.ts:73-76`

**Issue:**
```typescript
setTraceActive: (active) => set({
  isTraceActive: active,
  tracePoints: active ? [] : [],
}),
```

Both branches of the ternary produce `[]` — the ternary has no effect. This is likely a logical error where the intent was to preserve or clear points differently based on activation state (e.g., clear points when deactivating, or keep them when activating).

**Fix:** Determine the intended behavior and fix the ternary:
```typescript
setTraceActive: (active) => set({
  isTraceActive: active,
  tracePoints: active ? get().tracePoints : [], // keep points when activating, clear when deactivating
}),
```

---

### WR-03: fetchFromSupabase silently overwrites local state without merge

**File:** `src/store/campus-map-store.ts:133-154`, `src/store/graph-store.ts:241-257`

**Issue:** Both `fetchFromSupabase` implementations completely replace local state (`set({ maps, ... })`, `set({ graph, ... })`) when data arrives from the server. If a user has unsaved local changes (e.g., edits made while offline), fetching from Supabase will silently overwrite those changes. There is no merge strategy, conflict resolution, or confirmation prompt.

**Fix:** Implement a timestamp-based merge or prompt the user:
```typescript
const localUpdatedAt = get().maps.find(m => m.id === data.id)?.updatedAt
if (localUpdatedAt && localUpdatedAt > data.updatedAt) {
  // Local changes are newer — skip server update or prompt user
  return
}
set({ maps, ... })
```

---

### WR-04: Deeply nested try-catch with empty blocks throughout campus-map-store

**File:** `src/store/campus-map-store.ts:129,153,160,175`

**Issue:** Multiple empty catch blocks (`catch { /* offline */ }`, `catch { /* corrupt */ }`, `catch { /* silently retry next time */ }`) silently swallow all errors. Network errors, JSON parse failures, and data validation errors are indistinguishable. This makes debugging impossible and means data corruption could silently accumulate.

**Fix:** Log errors in development:
```typescript
catch (e) {
  if (process.env.NODE_ENV === 'development') {
    console.error('[campus-map-store] syncToSupabase failed:', e)
  }
  // Optionally set an error state for UI to display
}
```

---

### WR-05: Non-null assertions on env vars will produce confusing runtime errors

**Files:** `src/lib/supabase.ts:3-4`, `src/lib/supabase-client.ts:5-6`, `src/lib/supabase-server.ts:7-8`

**Issue:** All three files use the `!` (non-null assertion) operator on `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`. If these env vars are undefined at runtime (e.g., missing `.env.local`), the non-null assertion silences the TypeScript warning but the runtime value will be the string `"undefined"` coerced into the `createClient` call, producing a confusing authentication error rather than a clear "missing env var" message.

**Fix:** Add explicit validation:
```typescript
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
```

---

### WR-06: addComponent and addComponentWithPolygon are identical

**File:** `src/store/graph-store.ts:117-134` and `src/store/graph-store.ts:153-170`

**Issue:** Both functions have exactly the same implementation (compile component, add to graph, iterate nodes/edges, `set({})`). The only difference is the function name. This is dead code duplication — `addComponentWithPolygon` should be either removed or given different behavior (e.g., force polygon recalculation, return polygon data).

**Fix:** Remove the duplicate:
```typescript
// Remove addComponentWithPolygon entirely and keep only addComponent,
// or if they need different behavior, implement that difference.
```

---

### WR-07: deleteMap calls deleteFromSupabase after local state is already updated

**File:** `src/store/campus-map-store.ts:60-69`

**Issue:** The `deleteMap` function updates local state first, then calls `deleteFromSupabase`. If the Supabase deletion fails (network error, server error), the local state is already gone and cannot be recovered. The empty catch block on `deleteFromSupabase` means the caller never knows the deletion failed.

**Fix:** Reorder to delete from server first, then update local state:
```typescript
deleteMap: async (id) => {
  try {
    await get().deleteFromSupabase(id)
  } catch {
    // Optionally surface error to user
    throw new Error('Failed to delete map from server')
  }
  set((s) => ({
    maps: s.maps.filter((m) => m.id !== id),
    selectedMapId: s.selectedMapId === id ? null : s.selectedMapId,
    landmarkTypes: s.landmarkTypes.filter((t) => t.mapId !== id),
    landmarkInstances: s.landmarkInstances.filter((i) => i.mapId !== id),
  }))
  get().save()
},
```

---

### WR-08: useGeolocation has no cleanup — setState on unmounted component

**File:** `src/hooks/useGeolocation.ts:32-56`

**Issue:** The `useEffect` calls `navigator.geolocation.getCurrentPosition` with no cleanup/abort mechanism. If the component unmounts before the geolocation callback fires, `setState` will be called on an unmounted component. In React 18+ strict mode, this causes a memory leak warning. The `getCurrentPosition` does not return a cancelable handle like `watchPosition` does.

**Fix:** Use an abort flag or use GeoWatcher with cleanup:
```typescript
useEffect(() => {
  if (!navigator.geolocation) { ... }

  let cancelled = false
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (!cancelled) setState({ ... })
    },
    (error) => {
      if (!cancelled) setState({ ... })
    },
    { ... }
  )

  return () => { cancelled = true }
}, [])
```

---

### WR-09: GraphSnapshot.fromJSON() silently ignores unrecognized data

**File:** `src/engine/graph.ts:274-282`

**Issue:** `Graph.fromJSON` accesses `snapshot.components` and `snapshot.traces` with fallback (`?? []`), but silently ignores `snapshot.id`, `snapshot.version`, and `snapshot.updatedAt`. If the snapshot was serialized from a different schema version, deserialization proceeds without any validation or migration, potentially producing a graph with missing nodes or edges.

**Fix:** Add a version check or validation:
```typescript
static fromJSON(snapshot: GraphSnapshot): Graph {
  if (!snapshot.version) {
    console.warn('Graph snapshot missing version — attempting forward-compat')
  }
  // Version-based migration could go here
  const graph = new Graph()
  graph.setBuildings(snapshot.buildings)
  graph.setNodes(snapshot.nodes)
  graph.setEdges(snapshot.edges)
  graph.setComponents(snapshot.components ?? [])
  graph.setTraces((snapshot as any).traces ?? [])
  return graph
}
```

---

## Info

### IN-01: Mock auth should guard against production usage

**File:** `src/lib/mock-auth.ts:30-32`

**Issue:** `isMockAuthEnabled` checks `NEXT_PUBLIC_MOCK_AUTH === "true"` but this is only a convention — nothing prevents the mock auth functions from being called in production if this env var is accidentally set. The `MOCK_USERS` array with hardcoded emails and roles, combined with the base64 encoding (not real encryption), means mock sessions can be trivially forged.

**Suggestion:** Add a build-time guard:
```typescript
export function isMockAuthEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.NEXT_PUBLIC_MOCK_AUTH === "true"
}
```

---

### IN-02: Unused LatLng import in studio-store.ts

**File:** `src/store/studio-store.ts:3`

**Issue:** Line 3 imports `LatLng` from `'../types/nav-types'` but it's never referenced in the file. The file uses its own inline `{ lat: number; lng: number }` type annotations instead. This is a dead import.

**Suggestion:** Remove the unused import:
```typescript
import type { StudioTool, EditorMode, LayerVisibility } from '../types/studio-types'
```

---

### IN-03: save() in campus-map-store fires syncToSupabase without awaiting

**File:** `src/store/campus-map-store.ts:179-184`

**Issue:** The `save()` function calls `get().syncToSupabase()` but does not `await` it. If `syncToSupabase` throws, the error is silently caught inside that function, but if the caller of `save()` expects the sync to complete before proceeding (e.g., during cleanup), the operation is fire-and-forget.

**Suggestion:** Either make `save` async and await the sync, or document that sync is not guaranteed:
```typescript
save: () => {
  // ...
  localStorage.setItem(...)
  // Fire and forget — sync errors handled internally
  get().syncToSupabase().catch(() => {})
}
```

---

### IN-04: syncToSupabase iterates maps sequentially — no parallelism

**File:** `src/store/campus-map-store.ts:117-131`

**Issue:** The sync loop sends one `fetch` request per map sequentially with `await`. For 10+ maps, this creates a serial bottleneck. Using `Promise.allSettled` would sync in parallel and report individual failures.

**Suggestion:**
```typescript
syncToSupabase: async () => {
  if (typeof window === 'undefined') return
  const { maps, landmarkTypes, landmarkInstances } = get()
  const results = await Promise.allSettled(maps.map(async (map) => {
    const types = landmarkTypes.filter((t) => t.mapId === map.id)
    const instances = landmarkInstances.filter((i) => i.mapId === map.id)
    const res = await fetch('/api/campus-maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...map, landmarkTypes: types, landmarkInstances: instances }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }))
  const failures = results.filter((r) => r.status === 'rejected')
  if (failures.length > 0) {
    console.warn(`${failures.length} map(s) failed to sync`)
  }
}
```

---

### IN-05: Empty catch blocks in graph-store suppress error diagnostics

**File:** `src/store/graph-store.ts:180-182,196-198,254-256`

**Issue:** Three empty catch blocks silently swallow JSON parse errors from localStorage and network errors from `fetchFromSupabase`. A corrupt localStorage entry (e.g., truncated JSON) produces no console warning even in development, making debugging difficult.

**Suggestion:** Add development-only logging:
```typescript
catch (e) {
  if (process.env.NODE_ENV === 'development') {
    console.error('[graph-store] Failed to load/parse graph data:', e)
  }
}
```

---

### IN-06: toSnake/toCamel regex could mis-handle edge cases

**File:** `src/lib/db-schema.ts:22-27`

**Issue:** `toSnake` uses `key.replace(/([A-Z])/g, "_$1").toLowerCase()` which will add underscores before every uppercase letter. For single-word keys like `id` or `name`, this is fine. But for already-snake_case keys like `campus_id`, it would produce `campus__id` (double underscore). The `TS_TO_DB` lookup catches known keys first, but any unknown keys that happen to be snake_case would be double-converted. Similarly, `toCamel` uses `replace(/_([a-z])/g, ...)` which would miss underscores followed by non-lowercase characters.

**Suggestion:** Guard against double conversion:
```typescript
export function toSnake(key: string): string {
  if (key.includes('_')) return key  // already snake_case
  return TS_TO_DB[key] ?? key.replace(/([A-Z])/g, "_$1").toLowerCase()
}
```

---

_Reviewed: 2026-06-26T12:00:00Z_
_Reviewer: gsd-code-reviewer (deep cross-file analysis)_
_Depth: deep_
