# M2.6: StudioCanvas Migration

**Date:** 2026-07-10
**Status:** Design — for approval

## Objective

Transform `StudioCanvas` from a monolithic 896-line component (directly coupled to legacy Zustand stores and the raw `Graph`) into a **composition root** that orchestrates independent sub-modules — each with a single responsibility, aligned with the architecture established in M2.1–M2.5.

The canvas stops being "the editor" and becomes "the shell that hosts the editor."

---

## Target Architecture

```
StudioCanvas (~150-250 lines, composition root)
│
├── MapLibre lifecycle (create/dispose)
├── DrawingSessionProvider
│
├── ViewportController     — camera logic
├── MapRenderer            — document → GeoJSON → sources
├── InteractionController  — pointer events → ToolRegistry
├── SelectionOverlay       — map.setFeatureState() only
├── DrawingOverlay         — ephemeral drawing geometry
├── PreviewOverlay         — confirmation preview (pure render)
└── ConfirmBar             — UI buttons (pure presentational)
```

### Data Flow

```
User Input
    │
    ▼
InteractionController
    │
    ▼
ToolRegistry → Active Tool
    │
    ▼
ToolController
    │
    ▼
CommandDispatcher
    │
    ▼
CampusDocument
    │
    ▼
DocumentStore (version++ → React re-render)
    │
    ▼
MapRenderer → GeoJSON → MapLibre Sources
```

```
SelectionManager
    │
    ▼
SelectionOverlay → map.setFeatureState()
```

```
DrawingSession (React local state)
    │
    ├── DrawingOverlay → MapLibre Drawing Source
    ├── PreviewOverlay → MapLibre Drawing Source
    └── ConfirmBar     → renders buttons
```

```
ViewportService (extended)
    │
    ▼
ViewportController → MapLibre Camera
```

---

## Component Specifications

### 1. StudioCanvas (composition root)

**File:** `src/components/studio/StudioCanvas.tsx` — rewrite, target ~150-250 lines

**Responsibilities (exclusive):**
- Create and dispose the MapLibre GL instance (one-time, on mount)
- Initialize map sources and layers (once, after `style.load`)
- Mount all sub-components
- Provide `DrawingSession` via context

**What it explicitly does NOT contain:**
- ❌ Business / editing logic
- ❌ GeoJSON conversion helpers
- ❌ Event handlers (click, drag, keydown)
- ❌ Selection highlight logic
- ❌ Camera/viewport logic
- ❌ Drawing state management

**Migration from current code:**
- The `new maplibregl.Map(...)` initialization stays (lines 319-349)
- `addSourcesAndLayers()` stays but is called once (lines 133-166)
- Everything else moves to sub-modules

---

### 2. ViewportController

**File:** `src/components/studio/ViewportController.tsx` — new, ~60-80 lines

**Responsibility:** Translate `ViewportService` camera requests into MapLibre camera calls.

```tsx
interface ViewportControllerProps {
  map: maplibregl.Map
}
```

- Subscribes to the extended `Viewport` service (from `@navi/editor`)
- Checks for pending camera commands (`flyTo`, `fitBounds`, `easeTo`, `reset`)
- Executes them on the MapLibre instance
- Acknowledges executed commands back to the service

**What moves here from current StudioCanvas:**
- Initial camera position (part of line 326-327)
- `fitBounds`/`flyTo` on building selection (lines 390-402)

**Architectural rules:**
- ViewportController never reads `graph` or `tracePoints`
- ViewportController never renders anything
- ViewportController never handles pointer events

---

### 3. MapRenderer

**File:** `src/components/studio/MapRenderer.tsx` — new, ~100-150 lines

**Responsibility:** Render `CampusDocument` as GeoJSON on the map. No editing, no interaction, no selection, no cameras.

```tsx
interface MapRendererProps {
  map: maplibregl.Map
}
```

**Two phases:**

1. **Initialization** (runs once): Create sources and layers (moved from `addSourcesAndLayers`)
2. **Synchronization** (runs on every document version change): Convert `CampusDocument` to GeoJSON → call `source.setData()`

**What renders:**
- `document.buildings` → fill + extrusion + outline layers
- Building floors' rooms → polygon layers
- Building floors' hallways → line layers
- Building floors' entrances, staircases, elevators → point layers
- Roads (top-level) → line layers

**What does NOT render:**
- ❌ Compiled navigation graph (deferred to `NavigationGraphOverlay` in a future milestone)
- ❌ Selection highlights (owned by `SelectionOverlay`)
- ❌ Drawing previews (owned by `DrawingOverlay` / `PreviewOverlay`)

**Migration from current StudioCanvas:**
- `buildBuildingGeo()` (lines 66-78) → stays, but reads from `CampusDocument` instead of legacy `Graph`
- `buildNodeGeo()`, `buildEdgeGeo()`, `buildTracesGeo()` → the trace/node/edge layers are removed from MapRenderer (they'll come from compiled graph later)
- `syncAllData()` (lines 168-198) → replaced by the sync phase, reading from `CampusDocument`
- `addSourcesAndLayers()` setup (lines 133-166) → split into init phase here

**Architectural rules:**
- Reads `CampusDocument` via `useEditor()` + `useDocumentVersion()`
- Never reads `useStudioStore` or `useGraphStore`
- Never calls `map.setFeatureState()` — that's `SelectionOverlay`'s job
- Never handles pointer events — that's `InteractionController`'s job
- Never calls `map.flyTo()` — that's `ViewportController`'s job

---

### 4. InteractionController

**File:** `src/components/studio/InteractionController.tsx` — new, ~120-150 lines

**Responsibility:** Capture pointer and keyboard events on the map, normalize into `ToolPointerEvent`, forward to the active tool via `ToolRegistry`.

```tsx
interface InteractionControllerProps {
  map: maplibregl.Map
}
```

**Events captured:**
- `click`, `dblclick`, `mousedown`, `mousemove`, `mouseup` — map mouse events
- `keydown` — global keyboard events (Escape, Delete)

**Hit testing:**
- Query rendered features under pointer position
- Identify which layer was hit (node, building, trace, edge)
- Package hit info into `ToolPointerEvent`

**What moves here from current StudioCanvas:**
- All `map.on('click', handleClick)` event registrations (lines 640-654)
- `handleClick` logic (lines 408-475)
- `handleDblClick` (lines 477-482)
- `handleMouseDown` / `handleMouseMove` / `handleMouseUp` (lines 486-606)
- `handleKeyDown` (lines 608-638)
- `findNearestVertex()` helper (lines 302-317)
- Cursor style management (lines 657-666)

**Architectural rules:**
- Knows nothing about `CommandDispatcher` or business logic
- Forwards events only to `ToolRegistry`
- Does not render any UI

---

### 5. ToolController (hook)

**File:** `src/components/studio/useToolController.ts` — new, ~80-120 lines

**Responsibility:** Bridge between the tool system and the command system. Not a React component — it's a plain hook (no rendering).

- Listens for tool completion/cancel events from `ToolRegistry`
- When a tool produces output (e.g., `draw-room-tool` produces a polygon):
  1. Converts tool output into a Command (e.g., `room.create`)
  2. Calls `CommandDispatcher.execute(command)`
  3. Resets tool/drawing state via `DrawingSession`
- Handles undo/cancel flows
- Does NOT activate tools — that's `Toolbar` → `ToolRegistry` directly

**Architectural rules:**
- This is the **only** module that both knows about tools AND knows about commands
- Does not render any UI
- Does not handle events directly

---

### 6. SelectionOverlay

**File:** `src/components/studio/SelectionOverlay.tsx` — new, ~40-60 lines

**Responsibility:** The **only** component that calls `map.setFeatureState()`.

```tsx
interface SelectionOverlayProps {
  map: maplibregl.Map
}
```

- Reads `SelectionManager` via `useSelection()`
- When `lastSelected` changes: clears previous feature state, applies new highlight
- Handles `selected` and (future) `hovered` states

**Architectural rule (enforceable):**
```ts
// No other file in src/components/studio/ may import setFeatureState
```

**What moves here from current StudioCanvas:**
- Selection highlight sync effect (lines 364-388)
- Selection highlight in click handler (lines 432-448) — only the `setFeatureState` calls

---

### 7. DrawingOverlay

**File:** `src/components/studio/DrawingOverlay.tsx` — new, ~60-80 lines

**Responsibility:** Render ephemeral drawing geometry on the map's drawing source.

- Reads `DrawingSession` context
- Computes GeoJSON for trace-in-progress, draw-in-progress, room-drag rectangle
- Calls `map.getSource(SRC.DRAWING).setData(...)` on every relevant state change

**What moves here from current StudioCanvas:**
- `updateDrawingSource()` (lines 200-206)
- The `useEffect` that builds drawing GeoJSON (lines 729-772)

---

### 8. PreviewOverlay

**File:** `src/components/studio/PreviewOverlay.tsx` — new, ~40-60 lines

**Responsibility:** Render the "pending confirmation" state — what the user sees before confirming a trace/building/boundary.

- Reads `DrawingSession.pendingConfirm`
- Renders preview geometry (polygon for building/boundary, line for trace)
- Exposes `onConfirm` and `onCancel` callbacks (no confirmation logic itself)
- Pure renderer — no business decisions

---

### 9. ConfirmBar

**File:** `src/components/studio/ConfirmBar.tsx` — extracted, ~80-100 lines

**Responsibility:** The UI bar displayed during drawing interactions.

- Pure presentational component
- Receives props: `activePoints`, `canConfirm`, `routeWidth`, `toolLabel`, callbacks
- Replaces inline JSX from current StudioCanvas (lines 774-893)

---

### 10. DrawingSession (hook + context)

**File:** `src/components/studio/useDrawingSession.ts` — new, ~80-100 lines

**Responsibility:** Single owner of all ephemeral drawing state.

```tsx
function useDrawingSession() {
  const [tracePoints, setTracePoints] = useState<LatLng[]>([])
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([])
  const [routeWidth, setRouteWidth] = useState(8)
  const [roomDrag, setRoomDrag] = useState<DragState | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  
  // Actions
  const addTracePoint = (pt: LatLng) => {...}
  const undoLastPoint = () => {...}
  const clear = () => {...}
  const requestConfirm = () => {...}
  const confirm = () => {...}    // returns pending points for ToolController
  const cancel = () => {...}
  
  // Derived
  const activePoints = tool === 'route' ? tracePoints : drawPoints
  const canConfirm = tool === 'route' ? tracePoints.length >= 2 : drawPoints.length >= 3
  
  return { tracePoints, drawPoints, routeWidth, roomDrag, pendingConfirm, ... }
}
```

**Selective exposure:** Consumers receive only what they need, not the full session:

| Consumer | Receives |
|----------|----------|
| `InteractionController` | `addPoint()`, `confirm()`, `cancel()`, `activeTool` |
| `DrawingOverlay` | `tracePoints`, `drawPoints`, `roomDrag` |
| `PreviewOverlay` | `pendingConfirm` |
| `ConfirmBar` | `canConfirm`, `undo`, `confirm`, `cancel`, `routeWidth`, `activePoints` |

This is enforced by the interface each consumer accesses — not by passing the full `drawing` prop.

- State is local React state — never persisted, never synced
- After M2.6, corresponding fields in `useStudioStore` (tracePoints, drawPoints, routeWidth, pendingConfirm) become dead code
- Shared via `DrawingSessionProvider` context so overlays can consume it

---

### 11. ViewportService Extension

**File:** `packages/editor/src/viewport.ts` — extend existing `Viewport` class

Add camera command methods to the existing `Viewport` service:

```ts
class Viewport extends BaseEditorService {
  // Existing state accessors...
  
  // NEW: Camera command API
  private _pendingCommand: ViewportCommand | null = null
  private _revision = 0
  
  flyTo(center: LatLng, opts?: { zoom?: number; duration?: number }): void {
    this._pendingCommand = { type: 'flyTo', center, ...opts }
    this._revision++
    this.emit()
  }
  
  fitBounds(bounds: LngLatBounds, opts?: { padding?: number; duration?: number }): void {
    this._pendingCommand = { type: 'fitBounds', bounds, ...opts }
    this._revision++
    this.emit()
  }
  
  easeTo(opts: { center?: LatLng; zoom?: number; bearing?: number; pitch?: number }): void {
    this._pendingCommand = { type: 'easeTo', ...opts }
    this._revision++
    this.emit()
  }
  
  reset(): void {
    this._pendingCommand = { type: 'reset' }
    this._revision++
    this.emit()
  }
  
  zoomToSelection(): void {
    this._pendingCommand = { type: 'zoomToSelection' }
    this._revision++
    this.emit()
  }
  
  consumePendingCommand(): ViewportCommand | null {
    const cmd = this._pendingCommand
    this._pendingCommand = null
    return cmd
  }
}
```

**Key design rule:** The service expresses **intent** (camera requests). `ViewportController` performs **execution** (MapLibre camera calls). The service never imports MapLibre.

---

## Migration Plan

The migration happens in **tasks**, each producing an atomic commit. Tasks are ordered to keep intermediate states functional:

| Phase | Tasks | What changes |
|-------|-------|-------------|
| **Extract pure UI** | 1-6 | ConfirmBar, DrawingSession, ViewportController, SelectionOverlay, DrawingOverlay, PreviewOverlay — extracted structurally, no behavioral change. Legacy graph store still drives rendering. |
| **Bridge tools → commands** | 7-8 | ToolController + InteractionController created. Edits begin flowing through CommandDispatcher → CampusDocument. |
| **Refactor renderer** | 9 | MapRenderer switches to CampusDocument (now receiving writes from commands). |
| **Final composition** | 10 | StudioCanvas stripped to composition root. |
| **Cleanup + test** | 11-12 | Dead state removed, comprehensive tests. |

### Task 1: ViewportService Extension
- **Files:** `packages/editor/src/viewport.ts` + `packages/editor/src/viewport.test.ts`
- **Change:** Add `flyTo`, `fitBounds`, `easeTo`, `reset`, `zoomToSelection`, `consumePendingCommand` to `Viewport` service
- **Verification:** Existing viewport tests pass, new tests for command API and consume/ack cycle

### Task 2: Create DrawingSession hook + context
- **Files:** `src/components/studio/useDrawingSession.ts`
- **Change:** New file. Hook owns tracePoints, drawPoints, routeWidth, roomDrag, pendingConfirm. Context provider for sharing.
- **Verification:** Unit tests for hook logic (add, undo, clear, confirm, cancel)

### Task 3: Extract ConfirmBar
- **Files:** Create `src/components/studio/ConfirmBar.tsx`, update `StudioCanvas.tsx`
- **Change:** Extract inline confirm bar JSX (lines 774-893) into its own component. Wire via DrawingSession context.
- **Verification:** Confirm bar renders correctly with drawing session state

### Task 4: Create ViewportController
- **Files:** Create `src/components/studio/ViewportController.tsx`, update `StudioCanvas.tsx`
- **Change:** Extract camera logic (lines 390-402 + initial positioning) into ViewportController. Subscribe to extended ViewportService via `useEditor()`.
- **Verification:** Building selection still triggers flyTo, initial position is correct

### Task 5: Create SelectionOverlay
- **Files:** Create `src/components/studio/SelectionOverlay.tsx`, update `StudioCanvas.tsx`
- **Change:** Extract selection highlight logic (lines 364-388) + all `setFeatureState` calls from click handler into SelectionOverlay.
- **Verification:** Selection highlighting works, no duplicate setFeatureState calls

### Task 6: Create DrawingOverlay + PreviewOverlay
- **Files:** Create `src/components/studio/DrawingOverlay.tsx`, `src/components/studio/PreviewOverlay.tsx`, update `StudioCanvas.tsx`
- **Change:** Extract `updateDrawingSource` + drawing effects (lines 200-206, 729-772) into DrawingOverlay. Extract pending confirm rendering into PreviewOverlay (no confirmation logic — pure renderer).
- **Verification:** Drawing previews appear during trace/building/room interactions

### Task 7: Create ToolController hook
- **Files:** Create `src/components/studio/useToolController.ts`, update `StudioCanvas.tsx`
- **Change:** Create the bridge between tools and CommandDispatcher. Converts tool outputs into commands (room.create, building.create, etc.). Listens for tool completion events and executes commands.
- **Dependency:** Must be created BEFORE MapRenderer switches to CampusDocument, so writes flow through commands before the renderer reads from the command-backed document.
- **Verification:** Drawing a room creates a room via CommandDispatcher, not legacy graph mutation

### Task 8: Create InteractionController
- **Files:** Create `src/components/studio/InteractionController.tsx`, update `StudioCanvas.tsx`
- **Change:** Extract all event handlers (lines 640-654 + handler functions) into InteractionController. Wire through ToolRegistry from `@navi/editor`.
- **Transitional note on tool activation:** The current toolbar sets `useStudioStore.tool`. InteractionController reads this as a transitional adapter to activate the corresponding `ToolRegistry` tool. The long-term goal is toolbar → ToolRegistry directly (future milestone). This adapter keeps M2.6 focused on canvas decomposition.
- **Verification:** Click-to-select, click-to-add-trace-point, Escape/Delete handlers still work

### Task 9: Create MapRenderer
- **Files:** Create `src/components/studio/MapRenderer.tsx`, update `StudioCanvas.tsx`
- **Change:** Extract `addSourcesAndLayers`, GeoJSON builders, `syncAllData` into MapRenderer. Refactor to read from `CampusDocument` (via `useEditor()` + `useDocumentVersion()`) instead of legacy `Graph`.
- **Key changes:**
  - Buildings come from `document.buildings` not `graph.buildings`
  - Hallways come from `building.floors[].hallways` not `graph.traces`
  - Rooms come from `building.floors[].rooms` not `graph.components`
  - Nodes/edges are NOT rendered (deferred to future NavigationGraphOverlay)
- **Verification:** Map renders correctly with CampusDocument data. Unit tests for GeoJSON builders against CampusDocument fixtures.

### Task 10: Rewrite StudioCanvas as composition root
- **Files:** `src/components/studio/StudioCanvas.tsx`
- **Change:** Strip to composition root. Keep map creation, DrawingSessionProvider, mount sub-components.
- **Verification:** Everything still works, StudioCanvas is 150-250 lines

### Task 11: Delete dead legacy canvas state (optional cleanup)
- **Files:** `src/store/studio-store.ts`
- **Change:** Remove `tracePoints`, `drawPoints`, `routeWidth`, `pendingConfirm`, `selectedTraceId` from Zustand store (no longer used)
- **Verification:** Tests pass, no TypeScript errors

### Task 12: Tests
- **Files:** Create `src/components/studio/__tests__/*.test.tsx`
- **Changes per component:**
  - Unit tests for `DrawingSession` hook (add, undo, clear, confirm, cancel, derived state)
  - Unit tests for `ConfirmBar` (renders states, calls callbacks)
  - Unit tests for `InteractionController` (event forwarding to ToolRegistry)
  - Unit tests for `useToolController` (tool output → command translation)
  - Unit tests for `MapRenderer` GeoJSON builders (CampusDocument → expected GeoJSON)
  - Integration test for `StudioCanvas` (all sub-components wired together)
  - ViewportService tests in `@navi/editor` (flyTo/fitBounds command enqueue + consume)
- **Verification:** All tests pass, full `npm test` green (797+ existing + new)

---

## Invariants (FROZEN)

These are architectural invariants, not conveniences. They may not be changed without an architecture decision.

1. **`map.setFeatureState()` ownership** — `SelectionOverlay` is the only component that calls `map.setFeatureState()`. No other module may import or call it.

2. **`MapRenderer` reads only `CampusDocument`** — never `useGraphStore`, never `useStudioStore`, never selection state, never tool state.

3. **`InteractionController` does not execute commands** — it only forwards events to `ToolRegistry`. Command execution belongs in `ToolController`.

4. **`ViewportController` is the only component that calls MapLibre camera methods** (`flyTo`, `fitBounds`, `easeTo`, `setCenter`, `setZoom`). No other module imports these.

5. **Drawing state is local** — `DrawingSession` uses React state, not a global store or service. Drawn geometry is ephemeral until confirmed, at which point `ToolController` creates a persistent entity via `CommandDispatcher`.

6. **ViewportService expresses intent, not execution** — its camera methods enqueue requests. `ViewportController` executes them against MapLibre. The service never imports MapLibre.

---

## Success Criteria

1. StudioCanvas is ≤250 lines and contains no business logic, no event handlers, no GeoJSON conversion
2. All existing map interactions work: click-to-select, trace drawing, building footprint, room drawing, keyboard shortcuts
3. Map rendering reads from `CampusDocument` via `DocumentStore` — not from legacy `useGraphStore`
4. All 9 sub-components have unit tests
5. All old StudioCanvas functionality has a test that exercises the final architecture (integration test)
6. `npm test` is green (797+ existing tests + new tests)
7. No regressions in Explorer, PropertiesPanel, WorkflowCard, or Toolbar

---

---

## State Ownership Table

| State | Owner | Persistence | Consumed By |
|-------|-------|-------------|-------------|
| `CampusDocument` | `DocumentStore` | In-memory + save/publish | `MapRenderer`, `SelectionManager`, `CommandDispatcher`, `PropertiesPanel` |
| Selection | `SelectionManager` | In-memory (ephemeral) | `SelectionOverlay`, `ExplorerPanel`, `PropertiesPanel` |
| Workflow | `WorkflowStore` | In-memory (ephemeral) | `WorkflowCard`, `ToolController` |
| Viewport | `Viewport` service (in `@navi/editor`) | In-memory + events | `ViewportController` |
| Drawing session | `useDrawingSession()` (React local state) | None (ephemeral) | `InteractionController`, `DrawingOverlay`, `PreviewOverlay`, `ConfirmBar` |
| Map instance | `StudioCanvas` (useRef) | None (DOM) | All sub-components (passed as prop) |
| Commands | `CommandDispatcher` | In-memory + history | `CampusDocument` |
| Rendering / GeoJSON | `MapRenderer` | Derived (recomputed) | MapLibre sources |

**Rule:** No module may write to state it does not own. For example, `InteractionController` does not write to `CampusDocument` — it only writes to `DrawingSession` and forwards to `ToolRegistry`.

---

## Non-Goals (out of scope for M2.6)

- ❌ Rendering the compiled navigation graph (deferred to future milestone)
- ❌ Collaborative editing
- ❌ AI-assisted editing tools
- ❌ Validation overlay on the map
- ❌ Deleting legacy `legacy/` inspector files (deferred until after M2.7)
- ❌ Removing `tracePoints`, `drawPoints`, `routeWidth` from `useStudioStore` (safe to do as optional Task 11, but not required for M2.6 completion)
