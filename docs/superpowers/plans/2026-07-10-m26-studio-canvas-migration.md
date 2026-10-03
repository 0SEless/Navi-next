# M2.6 StudioCanvas Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 896-line monolithic `StudioCanvas` into 9 independent sub-modules with a composition root, routing all edits through `ToolController → CommandDispatcher → CampusDocument → MapRenderer`.

**Architecture:** StudioCanvas becomes a thin shell that creates MapLibre, mounts ViewportController/MapRenderer/InteractionController/SelectionOverlay/DrawingOverlay/PreviewOverlay/ConfirmBar, and shares ephemeral drawing state via DrawingSession hook. The editor package's Viewport service is extended with camera command API.

**Tech Stack:** React 19, TypeScript, MapLibre GL JS, `@navi/editor` (CommandRegistry, ToolRegistry, SelectionManager, Viewport service), Zustand (legacy, being migrated away from), Vitest

## Global Constraints

- Every sub-component must have unit tests
- All existing 797+ tests must continue to pass
- StudioCanvas must be ≤250 lines after migration
- No file may be >400 lines (except the final StudioCanvas composition root which should be <250)
- `map.setFeatureState()` may only be called inside `SelectionOverlay`
- MapLibre camera methods (`flyTo`, `fitBounds`, `easeTo`) may only be called inside `ViewportController`
- All new files under `src/components/studio/`
- Legacy `useGraphStore` and `useStudioStore` dependencies must be removed from StudioCanvas and its children
- Each task produces an atomic commit

---

### File Map

```
src/components/studio/
├── StudioCanvas.tsx          ← REWRITE (composition root, ~200 lines)
├── ViewportController.tsx    ← NEW (~70 lines)
├── MapRenderer.tsx           ← NEW (~140 lines)
├── InteractionController.tsx ← NEW (~160 lines)
├── useToolController.ts      ← NEW (~100 lines, hook)
├── SelectionOverlay.tsx      ← NEW (~50 lines)
├── DrawingOverlay.tsx        ← NEW (~70 lines)
├── PreviewOverlay.tsx        ← NEW (~50 lines)
├── ConfirmBar.tsx            ← EXTRACTED (~90 lines, from inline JSX)
└── useDrawingSession.ts      ← NEW (~120 lines, hook + context)

packages/editor/src/
└── viewport.ts               ← EXTEND (add flyTo, fitBounds, easeTo, reset, zoomToSelection, consumePendingCommand)

src/components/studio/__tests__/
├── useDrawingSession.test.ts
├── ConfirmBar.test.tsx
├── InteractionController.test.ts
├── useToolController.test.ts
├── MapRenderer.test.ts
├── SelectionOverlay.test.tsx
└── StudioCanvas.test.tsx       ← integration test

packages/editor/src/
└── viewport.test.ts           ← EXTEND (add camera command tests)
```

---

### Task 1: ViewportService Extension

**Files:**
- Modify: `packages/editor/src/viewport.ts`
- Modify: `packages/editor/src/viewport.test.ts`

**Interfaces:**
- Consumes: existing `BaseEditorService`, `DocumentEventBus`, `LatLng`
- Produces: extended `Viewport` class with `flyTo()`, `fitBounds()`, `easeTo()`, `reset()`, `zoomToSelection()`, `consumePendingCommand()`

- [ ] **Step 1: Add camera command tests to viewport.test.ts**

```typescript
// add to packages/editor/src/viewport.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Viewport } from '../viewport'

describe('Viewport camera commands', () => {
  let viewport: Viewport

  beforeEach(() => {
    viewport = new Viewport()
  })

  it('enqueues a flyTo command', () => {
    viewport.flyTo({ lat: 10, lng: 20 }, { zoom: 18 })
    const cmd = viewport.consumePendingCommand()
    expect(cmd).not.toBeNull()
    expect(cmd!.type).toBe('flyTo')
    expect(cmd!.center).toEqual({ lat: 10, lng: 20 })
    expect(cmd!.zoom).toBe(18)
  })

  it('enqueues a fitBounds command', () => {
    const bounds = { _sw: { lat: 0, lng: 0 }, _ne: { lat: 1, lng: 1 } } as any
    viewport.fitBounds(bounds, { padding: 50 })
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('fitBounds')
    expect(cmd!.padding).toBe(50)
  })

  it('enqueues an easeTo command', () => {
    viewport.easeTo({ center: { lat: 5, lng: 5 }, zoom: 16 })
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('easeTo')
  })

  it('enqueues a reset command', () => {
    viewport.reset()
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('reset')
  })

  it('enqueues a zoomToSelection command', () => {
    viewport.zoomToSelection()
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('zoomToSelection')
  })

  it('returns null when no command is pending', () => {
    expect(viewport.consumePendingCommand()).toBeNull()
  })

  it('clears command after consume', () => {
    viewport.flyTo({ lat: 0, lng: 0 })
    viewport.consumePendingCommand()
    expect(viewport.consumePendingCommand()).toBeNull()
  })

  it('increments revision on each command', () => {
    const r1 = viewport['_revision']
    viewport.flyTo({ lat: 0, lng: 0 })
    const r2 = viewport['_revision']
    expect(r2).toBe(r1 + 1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/editor && npx vitest run src/viewport.test.ts`
Expected: FAIL — methods not defined, types missing

- [ ] **Step 3: Extend Viewport class with camera command API**

```typescript
// In packages/editor/src/viewport.ts, add to the Viewport class:

export type ViewportCommand =
  | { type: 'flyTo'; center: LatLng; zoom?: number; duration?: number }
  | { type: 'fitBounds'; bounds: LngLatBoundsLike; padding?: number; duration?: number }
  | { type: 'easeTo'; center?: LatLng; zoom?: number; bearing?: number; pitch?: number; duration?: number }
  | { type: 'reset' }
  | { type: 'zoomToSelection' }

// Inside class Viewport:
private _pendingCommand: ViewportCommand | null = null
private _revision = 0

get revision(): number { return this._revision }

flyTo(center: LatLng, opts?: { zoom?: number; duration?: number }): void {
  this._pendingCommand = { type: 'flyTo', center, ...opts }
  this._revision++
  this.emit()
}

fitBounds(bounds: LngLatBoundsLike, opts?: { padding?: number; duration?: number }): void {
  this._pendingCommand = { type: 'fitBounds', bounds, ...opts }
  this._revision++
  this.emit()
}

easeTo(opts: { center?: LatLng; zoom?: number; bearing?: number; pitch?: number; duration?: number }): void {
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
```

Also add the import (if not already present):
```typescript
import type { LngLatBoundsLike } from 'maplibre-gl'
```

Or better, define bounds as a serializable interface (avoid importing MapLibre into the service):
```typescript
export interface BoundsLike {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}
```

And update `fitBounds` to use `BoundsLike` instead of `LngLatBoundsLike` to keep the service renderer-agnostic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/editor && npx vitest run src/viewport.test.ts`
Expected: PASS — all 8 new + all existing viewport tests

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/viewport.ts packages/editor/src/viewport.test.ts
git commit -m "feat(editor): extend Viewport service with camera command API (flyTo, fitBounds, easeTo, reset, zoomToSelection)"
```

---

### Task 2: Create DrawingSession hook + context

**Files:**
- Create: `src/components/studio/useDrawingSession.ts`

**Interfaces:**
- Consumes: `LatLng` (from `@/types/nav-types`), `PendingConfirm` type (from current `studio-store.ts`)
- Produces: `useDrawingSession()` hook, `DrawingSessionProvider` component, `useDrawingSessionContext()` hook

- [ ] **Step 1: Write tests for DrawingSession hook**

Create `src/components/studio/__tests__/useDrawingSession.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDrawingSession } from '../useDrawingSession'

describe('useDrawingSession', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useDrawingSession())
    expect(result.current.tracePoints).toEqual([])
    expect(result.current.drawPoints).toEqual([])
    expect(result.current.routeWidth).toBe(8)
    expect(result.current.pendingConfirm).toBeNull()
    expect(result.current.roomDrag).toBeNull()
  })

  it('adds a trace point', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 10, lng: 20 }))
    expect(result.current.tracePoints).toHaveLength(1)
    expect(result.current.tracePoints[0]).toEqual({ lat: 10, lng: 20 })
  })

  it('adds multiple trace points', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    expect(result.current.tracePoints).toHaveLength(2)
  })

  it('undoes last trace point', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.undoLastPoint())
    expect(result.current.tracePoints).toHaveLength(1)
    expect(result.current.tracePoints[0]).toEqual({ lat: 1, lng: 2 })
  })

  it('clears all trace points', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.clearTracePoints())
    expect(result.current.tracePoints).toEqual([])
  })

  it('sets pending confirm from trace points (route)', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.requestConfirm())
    expect(result.current.pendingConfirm).not.toBeNull()
    expect(result.current.pendingConfirm!.type).toBe('route')
    expect(result.current.pendingConfirm!.points).toHaveLength(2)
  })

  it('clears pending confirm on cancel', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.requestConfirm())
    act(() => result.current.cancel())
    expect(result.current.pendingConfirm).toBeNull()
    expect(result.current.tracePoints).toEqual([])
  })

  it('manages routeWidth with min/max clamping', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.setRouteWidth(2))
    expect(result.current.routeWidth).toBe(2)
    act(() => result.current.setRouteWidth(1)) // below min
    expect(result.current.routeWidth).toBe(2)
    act(() => result.current.setRouteWidth(25)) // above max
    expect(result.current.routeWidth).toBe(24)
  })

  it('computes canConfirm for route (needs >= 2 points)', () => {
    const { result } = renderHook(() => useDrawingSession('route'))
    expect(result.current.canConfirm).toBe(false)
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    expect(result.current.canConfirm).toBe(false)
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    expect(result.current.canConfirm).toBe(true)
  })

  it('computes canConfirm for building/boundary (needs >= 3 points)', () => {
    const { result } = renderHook(() => useDrawingSession('building'))
    expect(result.current.canConfirm).toBe(false)
    act(() => result.current.addDrawPoint({ lat: 1, lng: 2 }))
    act(() => result.current.addDrawPoint({ lat: 3, lng: 4 }))
    expect(result.current.canConfirm).toBe(false)
    act(() => result.current.addDrawPoint({ lat: 5, lng: 6 }))
    expect(result.current.canConfirm).toBe(true)
  })

  it('provides confirm() that returns pending points and clears state', () => {
    const { result } = renderHook(() => useDrawingSession('route'))
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.requestConfirm())
    const points = result.current.confirm()
    expect(points).toHaveLength(2)
    expect(result.current.pendingConfirm).toBeNull()
    expect(result.current.tracePoints).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/studio/__tests__/useDrawingSession.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DrawingSession hook + context**

Create `src/components/studio/useDrawingSession.ts`:
```typescript
'use client'

import { useState, useCallback, createContext, useContext, type ReactNode } from 'react'
import type { LatLng } from '@/types/nav-types'

type PendingType = 'building' | 'boundary' | 'route'
type DrawingTool = 'route' | 'building' | 'boundary'

interface PendingConfirm {
  type: PendingType
  points: LatLng[]
}

interface DragState {
  start: LatLng
  current: LatLng
}

interface DrawingSessionValue {
  // State
  tracePoints: LatLng[]
  drawPoints: LatLng[]
  routeWidth: number
  roomDrag: DragState | null
  pendingConfirm: PendingConfirm | null

  // Trace actions
  addTracePoint: (pt: LatLng) => void
  undoLastPoint: () => void
  clearTracePoints: () => void

  // Draw actions
  addDrawPoint: (pt: LatLng) => void
  undoLastDrawPoint: () => void
  clearDrawPoints: () => void

  // Room drag
  setRoomDrag: (drag: DragState | null) => void

  // Confirm flow
  requestConfirm: () => void
  confirm: () => LatLng[]
  cancel: () => void

  // Width
  setRouteWidth: (width: number) => void

  // Derived
  activePoints: LatLng[]
  canConfirm: boolean
}

const DrawingSessionContext = createContext<DrawingSessionValue | null>(null)

export function useDrawingSession(initialTool: DrawingTool = 'route'): DrawingSessionValue {
  const [tracePoints, setTracePoints] = useState<LatLng[]>([])
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([])
  const [routeWidth, setRouteWidthState] = useState(8)
  const [roomDrag, setRoomDrag] = useState<DragState | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  const addTracePoint = useCallback((pt: LatLng) => {
    setTracePoints(prev => [...prev, pt])
  }, [])

  const undoLastPoint = useCallback(() => {
    setTracePoints(prev => prev.slice(0, -1))
  }, [])

  const clearTracePoints = useCallback(() => {
    setTracePoints([])
  }, [])

  const addDrawPoint = useCallback((pt: LatLng) => {
    setDrawPoints(prev => [...prev, pt])
  }, [])

  const undoLastDrawPoint = useCallback(() => {
    setDrawPoints(prev => prev.slice(0, -1))
  }, [])

  const clearDrawPoints = useCallback(() => {
    setDrawPoints([])
  }, [])

  const requestConfirm = useCallback(() => {
    if (initialTool === 'route' && tracePoints.length >= 2) {
      setPendingConfirm({ type: 'route', points: [...tracePoints] })
    } else if ((initialTool === 'building' || initialTool === 'boundary') && drawPoints.length >= 3) {
      setPendingConfirm({ type: initialTool, points: [...drawPoints] })
    }
  }, [initialTool, tracePoints, drawPoints])

  const confirm = useCallback((): LatLng[] => {
    const points = pendingConfirm?.points ?? []
    setPendingConfirm(null)
    setTracePoints([])
    setDrawPoints([])
    return points
  }, [pendingConfirm])

  const cancel = useCallback(() => {
    setPendingConfirm(null)
    setTracePoints([])
    setDrawPoints([])
  }, [])

  const setRouteWidth = useCallback((width: number) => {
    setRouteWidthState(Math.max(2, Math.min(24, width)))
  }, [])

  // Determine active tool based on what has points (or initial tool)
  const tool = tracePoints.length > 0 ? 'route' : initialTool
  const activePoints = tool === 'route' ? tracePoints : drawPoints
  const canConfirm = tool === 'route'
    ? tracePoints.length >= 2
    : drawPoints.length >= 3

  return {
    tracePoints,
    drawPoints,
    routeWidth,
    roomDrag,
    pendingConfirm,
    addTracePoint,
    undoLastPoint,
    clearTracePoints,
    addDrawPoint,
    undoLastDrawPoint,
    clearDrawPoints,
    setRoomDrag,
    requestConfirm,
    confirm,
    cancel,
    setRouteWidth,
    activePoints,
    canConfirm,
  }
}

export function DrawingSessionProvider({ children, value }: {
  children: ReactNode
  value: DrawingSessionValue
}) {
  return (
    <DrawingSessionContext.Provider value={value}>
      {children}
    </DrawingSessionContext.Provider>
  )
}

export function useDrawingSessionContext(): DrawingSessionValue {
  const ctx = useContext(DrawingSessionContext)
  if (!ctx) {
    throw new Error('useDrawingSessionContext must be used within DrawingSessionProvider')
  }
  return ctx
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/studio/__tests__/useDrawingSession.test.ts`
Expected: PASS — all 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/useDrawingSession.ts src/components/studio/__tests__/useDrawingSession.test.ts
git commit -m "feat(studio): add DrawingSession hook + context for ephemeral editing state"
```

---

### Task 3: Extract ConfirmBar

**Files:**
- Create: `src/components/studio/ConfirmBar.tsx`
- Create: `src/components/studio/__tests__/ConfirmBar.test.tsx`
- Modify: `src/components/studio/StudioCanvas.tsx` (inline JSX → import)

**Interfaces:**
- Consumes: `ConfirmBarProps { tracePoints, drawPoints, routeWidth, tool, canConfirm, onConfirm, onCancel, onUndo, onSetWidth, toolLabel }`
- Produces: extracted component

- [ ] **Step 1: Write ConfirmBar tests**

Create `src/components/studio/__tests__/ConfirmBar.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmBar } from '../ConfirmBar'

describe('ConfirmBar', () => {
  const defaultProps = {
    tracePoints: [] as any[],
    drawPoints: [] as any[],
    routeWidth: 8,
    tool: 'route' as const,
    canConfirm: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onUndo: vi.fn(),
    onSetWidth: vi.fn(),
    toolLabel: 'Campus route',
  }

  it('renders tool label', () => {
    render(<ConfirmBar {...defaultProps} />)
    expect(screen.getByText('Campus route')).toBeDefined()
  })

  it('shows point count', () => {
    render(<ConfirmBar {...defaultProps} tracePoints={[{ lat: 1, lng: 2 }]} />)
    expect(screen.getByText(/1 point/)).toBeDefined()
  })

  it('shows "need 2" when route has < 2 points', () => {
    render(<ConfirmBar {...defaultProps} tracePoints={[{ lat: 1, lng: 2 }]} />)
    expect(screen.getByText(/need 2/)).toBeDefined()
  })

  it('fires onConfirm when confirm button clicked and canConfirm is true', () => {
    const onConfirm = vi.fn()
    render(<ConfirmBar {...defaultProps} canConfirm={true} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables confirm button when canConfirm is false', () => {
    render(<ConfirmBar {...defaultProps} canConfirm={false} />)
    const btn = screen.getByText('Confirm').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('fires onCancel when cancel button clicked', () => {
    const onCancel = vi.fn()
    render(<ConfirmBar {...defaultProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('fires onUndo when undo button clicked', () => {
    const onUndo = vi.fn()
    render(<ConfirmBar {...defaultProps} tracePoints={[{ lat: 1, lng: 2 }]} onUndo={onUndo} />)
    fireEvent.click(screen.getByRole('button', { name: '' })) // Trash2 icon button
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('shows width controls for route tool', () => {
    render(<ConfirmBar {...defaultProps} tracePoints={[{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]} />)
    expect(screen.getByText('8')).toBeDefined()
    const buttons = screen.getAllByRole('button')
    const widthBtns = buttons.filter(b => b.textContent === '−' || b.textContent === '+')
    expect(widthBtns).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/studio/__tests__/ConfirmBar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Extract ConfirmBar component**

Create `src/components/studio/ConfirmBar.tsx`:
```typescript
'use client'

import { Trash2, Check, X } from 'lucide-react'
import type { LatLng } from '@/types/nav-types'

interface ConfirmBarProps {
  tracePoints: LatLng[]
  drawPoints: LatLng[]
  routeWidth: number
  tool: 'route' | 'building' | 'boundary'
  canConfirm: boolean
  onConfirm: () => void
  onCancel: () => void
  onUndo: () => void
  onSetWidth: (width: number) => void
  toolLabel: string
}

export function ConfirmBar({
  tracePoints,
  drawPoints,
  routeWidth,
  tool,
  canConfirm,
  onConfirm,
  onCancel,
  onUndo,
  onSetWidth,
  toolLabel,
}: ConfirmBarProps) {
  const currentPoints = tool === 'route' ? tracePoints : drawPoints
  const minPoints = tool === 'route' ? 2 : 3
  const pointsLabel = `${currentPoints.length} point${currentPoints.length !== 1 ? 's' : ''} (need ${minPoints})`

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 6, background: '#1E293B', borderRadius: 8, padding: '4px 6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10, alignItems: 'center',
    }}>
      <span style={{
        fontSize: 10, color: '#06B6D4',
        padding: '0 4px', fontWeight: 600, whiteSpace: 'nowrap',
      }}>
        {toolLabel}
      </span>
      <span style={{ fontSize: 10, color: '#94A3B8', padding: '0 4px' }}>
        {pointsLabel}
      </span>
      {tool === 'route' && (
        <>
          <button onClick={() => onSetWidth(routeWidth - 1)}
            style={{
              width: 24, height: 24, borderRadius: 4, border: 'none',
              background: '#475569', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, lineHeight: 1,
            }}
          >−</button>
          <span style={{ fontSize: 10, color: '#06B6D4', fontWeight: 600, minWidth: 16, textAlign: 'center' }}>
            {routeWidth}
          </span>
          <button onClick={() => onSetWidth(routeWidth + 1)}
            style={{
              width: 24, height: 24, borderRadius: 4, border: 'none',
              background: '#475569', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, lineHeight: 1,
            }}
          >+</button>
        </>
      )}
      <button onClick={onUndo} disabled={currentPoints.length < 1}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderRadius: 6,
          border: 'none', background: currentPoints.length < 1 ? '#374151' : '#475569',
          color: currentPoints.length < 1 ? '#6B7280' : '#fff', fontSize: 11,
          cursor: currentPoints.length < 1 ? 'not-allowed' : 'pointer',
        }}
      >
        <Trash2 size={12} />
      </button>
      <button onClick={onConfirm} disabled={!canConfirm}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6,
          border: 'none', background: !canConfirm ? '#374151' : '#10B981',
          color: !canConfirm ? '#6B7280' : '#fff', fontSize: 11,
          cursor: !canConfirm ? 'not-allowed' : 'pointer',
        }}
      >
        <Check size={12} /> Confirm
      </button>
      <button onClick={onCancel}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6,
          border: 'none', background: '#EF4444', color: '#fff', fontSize: 11, cursor: 'pointer',
        }}
      >
        <X size={12} /> Cancel
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Update StudioCanvas to use ConfirmBar component**

Replace the inline ConfirmBar JSX in StudioCanvas (lines 826-893) with:
```tsx
{tool === 'route' && tracePoints.length > 0 || (tool === 'building' || tool === 'boundary') && drawPoints.length > 0 ? (
  <ConfirmBar
    tracePoints={tracePoints}
    drawPoints={drawPoints}
    routeWidth={routeWidth}
    tool={tool}
    canConfirm={canConfirm}
    onConfirm={handleConfirm}
    onCancel={handleCancel}
    onUndo={handleUndo}
    onSetWidth={setRouteWidth}
    toolLabel={toolLabel}
  />
) : null}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/studio/__tests__/ConfirmBar.test.tsx`
Expected: PASS — all 8 tests

Run full test suite to verify no regressions: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/ConfirmBar.tsx src/components/studio/__tests__/ConfirmBar.test.tsx src/components/studio/StudioCanvas.tsx
git commit -m "refactor(studio): extract ConfirmBar from StudioCanvas inline JSX"
```

---

### Task 4: Create SelectionOverlay

**Files:**
- Create: `src/components/studio/SelectionOverlay.tsx`
- Create: `src/components/studio/__tests__/SelectionOverlay.test.tsx`
- Modify: `src/components/studio/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `map: maplibregl.Map`
- Produces: `SelectionOverlay` component — sole owner of `map.setFeatureState()`

- [ ] **Step 1: Write SelectionOverlay tests**

Create `src/components/studio/__tests__/SelectionOverlay.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { SelectionOverlay } from '../SelectionOverlay'
import { useEditor } from '@navi/editor'

vi.mock('@navi/editor', () => ({
  useEditor: vi.fn(),
  useSelection: vi.fn(),
}))

describe('SelectionOverlay', () => {
  const mockMap = {
    setFeatureState: vi.fn(),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useEditor as any).mockReturnValue({
      services: { get: () => null },
    })
  })

  it('renders nothing visible', () => {
    const { container } = render(<SelectionOverlay map={mockMap} />)
    expect(container.firstChild).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('calls setFeatureState when selection changes', () => {
    // This would need to mock useSelection to return changing values
    // and verify setFeatureState is called with correct args
  })
})
```

- [ ] **Step 2: Create SelectionOverlay component**

Create `src/components/studio/SelectionOverlay.tsx`:
```typescript
'use client'

import { useEffect, useRef } from 'react'
import { useSelection } from '@navi/editor'

interface SelectionOverlayProps {
  map: maplibregl.Map
}

const SRC_NODES = 's-nodes'
const SRC_NODES_CONNECTION = 's-nodes-connection'

export function SelectionOverlay({ map }: SelectionOverlayProps) {
  const { lastSelected } = useSelection()
  const lastHighlightedRef = useRef<string | null>(null)

  useEffect(() => {
    const prevId = lastHighlightedRef.current
    const currId = lastSelected?.id ?? null

    // Clear previous highlight
    if (prevId && prevId !== currId) {
      try {
        map.setFeatureState({ source: SRC_NODES, id: prevId }, { selected: false })
        map.setFeatureState({ source: SRC_NODES_CONNECTION, id: prevId }, { selected: false })
      } catch { /* node may no longer exist */ }
    }

    // Apply new highlight
    if (currId) {
      try {
        map.setFeatureState({ source: SRC_NODES, id: currId }, { selected: true })
        map.setFeatureState({ source: SRC_NODES_CONNECTION, id: currId }, { selected: true })
      } catch { /* node may no longer exist */ }
    }

    lastHighlightedRef.current = currId
  }, [map, lastSelected])

  return null
}
```

- [ ] **Step 3: Update StudioCanvas to use SelectionOverlay**

Replace the selection highlight effect (current lines 364-388) and remove `setFeatureState` calls from the click handler. Mount `<SelectionOverlay map={mapInstance} />`.

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run src/components/studio/__tests__/SelectionOverlay.test.tsx`
Expected: PASS

Run full test suite: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/SelectionOverlay.tsx src/components/studio/__tests__/SelectionOverlay.test.tsx src/components/studio/StudioCanvas.tsx
git commit -m "refactor(studio): extract SelectionOverlay — sole owner of map.setFeatureState()"
```

---

### Task 5: Create DrawingOverlay + PreviewOverlay

**Files:**
- Create: `src/components/studio/DrawingOverlay.tsx`
- Create: `src/components/studio/PreviewOverlay.tsx`
- Create: `src/components/studio/__tests__/DrawingOverlay.test.tsx`
- Create: `src/components/studio/__tests__/PreviewOverlay.test.tsx`
- Modify: `src/components/studio/StudioCanvas.tsx`

**Interfaces:**
- Consumes: DrawingSession state (via context or props), map instance
- Produces: DrawingOverlay (renders ephemeral drawing geometry), PreviewOverlay (renders pending confirm preview)

- [ ] **Step 1: Create DrawingOverlay**

```typescript
'use client'

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useDrawingSessionContext } from './useDrawingSession'
import type { LatLng } from '@/types/nav-types'

const SRC_DRAWING = 's-drawing'

function buildDrawingGeoJSON(tracePoints: LatLng[], drawPoints: LatLng[], roomDrag: any): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const points = tracePoints.length > 0 ? tracePoints : drawPoints

  if (points.length > 0) {
    const coords = points.map(p => [p.lng, p.lat])
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    })
    for (const p of points) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {},
      })
    }
  }

  if (roomDrag) {
    const s = roomDrag.start
    const c = roomDrag.current
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[s.lng, s.lat], [c.lng, s.lat], [c.lng, c.lat], [s.lng, c.lat], [s.lng, s.lat]]],
      },
      properties: {},
    })
  }

  return { type: 'FeatureCollection', features }
}

interface DrawingOverlayProps {
  map: maplibregl.Map
}

export function DrawingOverlay({ map }: DrawingOverlayProps) {
  const { tracePoints, drawPoints, roomDrag, pendingConfirm } = useDrawingSessionContext()

  useEffect(() => {
    // Skip ephemeral rendering when pending confirm is active —
    // PreviewOverlay handles that state.
    if (pendingConfirm) return
    try {
      const src = map.getSource(SRC_DRAWING) as maplibregl.GeoJSONSource
      if (src) {
        src.setData(buildDrawingGeoJSON(tracePoints, drawPoints, roomDrag))
      }
    } catch { /* source not ready */ }
  }, [map, tracePoints, drawPoints, roomDrag, pendingConfirm])

  return null
}
```

- [ ] **Step 2: Create PreviewOverlay**

```typescript
'use client'

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useDrawingSessionContext } from './useDrawingSession'

const SRC_DRAWING = 's-drawing'

function buildPreviewGeoJSON(pendingConfirm: any): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (!pendingConfirm || pendingConfirm.points.length < 2) {
    return { type: 'FeatureCollection', features: [] }
  }

  const isPolygon = pendingConfirm.type === 'building' || pendingConfirm.type === 'boundary'
  const coords = pendingConfirm.points.map((p: any) => [p.lng, p.lat])

  if (isPolygon && pendingConfirm.points.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
      properties: { pending: true },
    })
  }
  features.push({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: isPolygon && pendingConfirm.points.length >= 3 ? [...coords, coords[0]] : coords,
    },
    properties: { pending: true },
  })
  for (const p of pendingConfirm.points) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { pending: true },
    })
  }

  return { type: 'FeatureCollection', features }
}

interface PreviewOverlayProps {
  map: maplibregl.Map
}

export function PreviewOverlay({ map }: PreviewOverlayProps) {
  const { pendingConfirm } = useDrawingSessionContext()

  useEffect(() => {
    try {
      const src = map.getSource(SRC_DRAWING) as maplibregl.GeoJSONSource
      if (src) {
        src.setData(buildPreviewGeoJSON(pendingConfirm))
      }
    } catch { /* source not ready */ }
  }, [map, pendingConfirm])

  return null
}
```

- [ ] **Step 3: Write tests**

Create tests for DrawingOverlay and PreviewOverlay verifying they produce the correct GeoJSON from drawing session state.

- [ ] **Step 4: Update StudioCanvas**

Replace the drawing-related useEffect (current lines 729-772) and `updateDrawingSource` function with `<DrawingOverlay map={mapInstance} />` and `<PreviewOverlay map={mapInstance} />`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/DrawingOverlay.tsx src/components/studio/PreviewOverlay.tsx src/components/studio/StudioCanvas.tsx
git commit -m "refactor(studio): extract DrawingOverlay + PreviewOverlay from StudioCanvas"
```

---

### Task 6: Create ViewportController

**Files:**
- Create: `src/components/studio/ViewportController.tsx`
- Create: `src/components/studio/__tests__/ViewportController.test.tsx`
- Modify: `src/components/studio/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `map: maplibregl.Map`, extended `Viewport` service (via `useEditor()`)
- Consumes: `useWorkspace()` for building/buildingId changes

- [ ] **Step 1: Create ViewportController**

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { useEditor } from '@navi/editor'
import type { ViewportCommand } from '@navi/editor'
import maplibregl from 'maplibre-gl'

interface ViewportControllerProps {
  map: maplibregl.Map
  initialCenter?: { lat: number; lng: number }
}

export function ViewportController({ map, initialCenter }: ViewportControllerProps) {
  const { services } = useEditor()
  const viewport = services.get('viewport')
  const eventBus = services.get('eventBus')
  const readyRef = useRef(false)

  // Initial camera position
  useEffect(() => {
    if (initialCenter && !readyRef.current) {
      map.flyTo({ center: [initialCenter.lng, initialCenter.lat], zoom: 17 })
      readyRef.current = true
    }
  }, [map, initialCenter])

  // Subscribe to viewport.changed events → execute pending camera commands
  useEffect(() => {
    if (!viewport || !eventBus) return

    const executeCommand = () => {
      const cmd: ViewportCommand | null = viewport.consumePendingCommand()
      if (!cmd) return

      switch (cmd.type) {
        case 'flyTo':
          if (cmd.center) {
            map.flyTo({
              center: [cmd.center.lng, cmd.center.lat],
              zoom: cmd.zoom,
              duration: cmd.duration ?? 500,
            })
          }
          break
        case 'fitBounds':
          if (cmd.bounds) {
            const bounds = new maplibregl.LngLatBounds(
              [cmd.bounds.sw.lng, cmd.bounds.sw.lat],
              [cmd.bounds.ne.lng, cmd.bounds.ne.lat],
            )
            map.fitBounds(bounds, { padding: cmd.padding ?? 80, duration: cmd.duration ?? 500 })
          }
          break
        case 'easeTo':
          map.easeTo({
            center: cmd.center ? [cmd.center.lng, cmd.center.lat] : undefined,
            zoom: cmd.zoom,
            bearing: cmd.bearing,
            pitch: cmd.pitch,
            duration: cmd.duration ?? 500,
          })
          break
        case 'reset':
          map.flyTo({ center: [0, 0], zoom: 15, bearing: 0, pitch: 0 })
          break
        case 'zoomToSelection':
          // zoomToSelection is delegated to SelectionOverlay
          break
      }
    }

    // Run once on mount (in case a command was queued before mount)
    executeCommand()

    // Subscribe to viewport.changed events (emitted by Viewport on every state change)
    const unsub = eventBus.on('viewport.changed', executeCommand)
    return () => { unsub() }
  }, [map, viewport, eventBus])

  return null
}
```

Note: The `viewport.onChange` subscription depends on whether the Viewport service exposes an `onChange` callback. If not, the controller can subscribe to `eventBus.on('viewport.changed', ...)` or use a polling pattern via `useEffect` + `useSyncExternalStore`.

- [ ] **Step 2: Update StudioCanvas**

Replace inline camera logic (current lines 390-402 and initial positioning) with `<ViewportController map={mapInstance} initialCenter={center} />`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/ViewportController.tsx src/components/studio/StudioCanvas.tsx
git commit -m "refactor(studio): extract ViewportController — sole owner of MapLibre camera methods"
```

---

### Task 7: Create useToolController hook

**Files:**
- Create: `src/components/studio/useToolController.ts`
- Create: `src/components/studio/__tests__/useToolController.test.ts`
- Modify: `src/components/studio/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `ToolRegistry` (from `@navi/editor`), `CommandDispatcher`, `DrawingSession`
- Produces: bridge logic that converts tool completion events into commands

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { useToolController } from '../useToolController'

describe('useToolController', () => {
  it('executes room.create command when draw-room-tool completes', () => {
    const execute = vi.fn()
    const toolRegistry = { onToolComplete: vi.fn() }
    // Should subscribe to tool events and dispatch commands
  })
})
```

- [ ] **Step 2: Create useToolController**

```typescript
'use client'

import { useEffect } from 'react'
import { useEditor } from '@navi/editor'

export function useToolController() {
  const { services } = useEditor()
  const dispatcher = services.get('dispatcher')
  const toolRegistry = services.get('toolRegistry')

  useEffect(() => {
    if (!toolRegistry || !dispatcher) return

    const handleToolComplete = (result: any) => {
      if (!result?.command) return
      dispatcher.execute(result.command, result.payload)
    }

    toolRegistry.on('tool.complete', handleToolComplete)
    return () => toolRegistry.off('tool.complete', handleToolComplete)
  }, [dispatcher, toolRegistry])
}
```

Note: The actual event API depends on `ToolRegistry`'s implementation. If `ToolRegistry` uses a different event mechanism, adapt accordingly.

- [ ] **Step 3: Update StudioCanvas**

Mount `useToolController()` as a hook in StudioCanvas (no JSX needed since it's a hook).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/useToolController.ts src/components/studio/StudioCanvas.tsx
git commit -m "feat(studio): add useToolController hook — bridges tool completion to CommandDispatcher"
```

---

### Task 8: Create InteractionController

**Files:**
- Create: `src/components/studio/InteractionController.tsx`
- Create: `src/components/studio/__tests__/InteractionController.test.tsx`
- Modify: `src/components/studio/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `map: maplibregl.Map`, `ToolRegistry`, DrawingSession actions
- Produces: event capture and forwarding component

- [ ] **Step 1: Write InteractionController tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { InteractionController } from '../InteractionController'

describe('InteractionController', () => {
  it('registers map event listeners on mount', () => {
    const map = { on: vi.fn(), off: vi.fn() } as any
    const { unmount } = render(<InteractionController map={map} />)
    expect(map.on).toHaveBeenCalledTimes(5) // click, dblclick, mousedown, mousemove, mouseup
    unmount()
    expect(map.off).toHaveBeenCalledTimes(5)
  })
})
```

- [ ] **Step 2: Create InteractionController**

```typescript
'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'

interface InteractionControllerProps {
  map: maplibregl.Map
}

const LYR_NODES = 'l-nodes'
const LYR_NODES_CONNECTION = 'l-nodes-connection'
const LYR_BUILDINGS_EXTRUSION = 'l-buildings-extrusion'
const LYR_BUILDINGS_FILL = 'l-buildings-fill'
const LYR_TRACES_LINE = 'l-traces-line'
const LYR_TRACES_INNER = 'l-traces-inner'

const SRC_NODES = 's-nodes'
const SRC_NODES_CONNECTION = 's-nodes-connection'

export function InteractionController({ map }: InteractionControllerProps) {
  const lastSelectedNodeRef = useRef<string | null>(null)

  useEffect(() => {
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point)

      // Hit test: nodes first
      const hitNode = features.find(
        (f) => f.layer.id === LYR_NODES || f.layer.id === LYR_NODES_CONNECTION
      )
      if (hitNode) {
        const nodeId = hitNode.properties?.id as string | null
        if (nodeId) {
          // Forward to SelectionManager via ToolRegistry
          lastSelectedNodeRef.current = nodeId
          return
        }
      }

      // Hit test: buildings
      const hitBuilding = features.find(
        (f) => f.layer.id === LYR_BUILDINGS_EXTRUSION || f.layer.id === LYR_BUILDINGS_FILL
      )
      if (hitBuilding) {
        const bid = hitBuilding.properties?.id
        if (bid) {
          // Forward to SelectionManager via ToolRegistry
          return
        }
      }

      // Hit test: traces
      const hitTrace = features.find(
        (f) => f.layer.id === LYR_TRACES_LINE || f.layer.id === LYR_TRACES_INNER
      )
      if (hitTrace) {
        const tid = hitTrace.properties?.id
        if (tid) {
          // Forward to SelectionManager via ToolRegistry
          return
        }
      }

      // Deselect
      lastSelectedNodeRef.current = null
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Clear drawing state
      }
      if (e.key === 'Delete' && lastSelectedNodeRef.current) {
        // Delete selected node
      }
    }

    map.on('click', handleClick)
    map.on('dblclick', () => { /* confirm trace */ })
    map.on('mousedown', () => { /* start drag */ })
    map.on('mousemove', () => { /* continue drag */ })
    map.on('mouseup', () => { /* end drag */ })
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      map.off('click', handleClick)
      map.off('dblclick', () => {})
      map.off('mousedown', () => {})
      map.off('mousemove', () => {})
      map.off('mouseup', () => {})
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [map])

  return null
}
```

- [ ] **Step 3: Update StudioCanvas**

Replace the event registration useEffect (current lines 640-654) and all event handler functions with `<InteractionController map={mapInstance} />`.

**Important:** This step must NOT remove any event handlers from StudioCanvas until all behavior is verified working through InteractionController.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/InteractionController.tsx src/components/studio/StudioCanvas.tsx
git commit -m "refactor(studio): extract InteractionController — all pointer/keyboard event handling"
```

---

### Task 9: Create MapRenderer

**Files:**
- Create: `src/components/studio/MapRenderer.tsx`
- Create: `src/components/studio/__tests__/MapRenderer.test.ts`
- Modify: `src/components/studio/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `map: maplibregl.Map`, `CampusDocument` (via `useEditor()` + `useDocumentVersion()`)
- Consumes: layer constants from current StudioCanvas
- Produces: document → GeoJSON → MapLibre sources

- [ ] **Step 1: Write MapRenderer tests**

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

// Test the GeoJSON builders with CampusDocument fixtures
describe('MapRenderer GeoJSON builders', () => {
  it('builds building GeoJSON from CampusDocument', () => {
    const doc = {
      buildings: [{
        id: 'BLD01',
        name: 'Main Building',
        footprint: { points: [{ lat: 10, lng: 20 }, { lat: 10, lng: 21 }, { lat: 11, lng: 21 }] },
        height: 15,
        color: '#1C6BEB',
      }],
    } as any
    // Test the GeoJSON conversion
    // expect(buildBuildingGeo(doc.buildings)).toEqual(...)
  })
})
```

- [ ] **Step 2: Create MapRenderer**

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { useEditor, useDocumentVersion } from '@navi/editor'
import maplibregl from 'maplibre-gl'

const SRC_BUILDINGS = 's-buildings'
const LYR_BUILDINGS_FILL = 'l-buildings-fill'
const LYR_BUILDINGS_EXTRUSION = 'l-buildings-extrusion'
const LYR_BUILDINGS_OUTLINE = 'l-buildings-outline'

function buildBuildingGeo(buildings: any[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: buildings.map((b: any) => ({
      type: 'Feature',
      properties: {
        id: b.id,
        name: b.name,
        color: b.color || '#1C6BEB',
        height: b.height || 15,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [b.footprint.points.map((p: any) => [p.lng, p.lat] as [number, number])],
      },
    })),
  }
}

function initializeSourcesAndLayers(map: maplibregl.Map): void {
  if (map.getSource(SRC_BUILDINGS)) return

  map.addSource(SRC_BUILDINGS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: LYR_BUILDINGS_FILL, type: 'fill', source: SRC_BUILDINGS,
    paint: { 'fill-color': '#1C6BEB', 'fill-opacity': 0.08 },
  })
  map.addLayer({
    id: LYR_BUILDINGS_EXTRUSION, type: 'fill-extrusion', source: SRC_BUILDINGS,
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-opacity': 0.65,
      'fill-extrusion-base': 0,
    },
  })
  map.addLayer({
    id: LYR_BUILDINGS_OUTLINE, type: 'line', source: SRC_BUILDINGS,
    paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
  })
}

interface MapRendererProps {
  map: maplibregl.Map
}

export function MapRenderer({ map }: MapRendererProps) {
  const { document } = useEditor()
  const version = useDocumentVersion()
  const initializedRef = useRef(false)

  // Init: once
  useEffect(() => {
    if (initializedRef.current) return
    initializeSourcesAndLayers(map)
    initializedRef.current = true
  }, [map])

  // Sync: on every document version change
  useEffect(() => {
    if (!initializedRef.current) return

    try {
      const buildingsSrc = map.getSource(SRC_BUILDINGS) as maplibregl.GeoJSONSource
      if (buildingsSrc) {
        buildingsSrc.setData(buildBuildingGeo(document.buildings ?? []))
      }
    } catch { /* source not ready */ }
  }, [map, document, version])

  return null
}
```

**Note:** This initial version renders only buildings. Hallways, rooms, and other entity types will be added incrementally in the same pattern — each entity type gets its own GeoJSON builder and source/layer, added to `initializeSourcesAndLayers` and the sync effect.

- [ ] **Step 3: Update StudioCanvas**

Replace `addSourcesAndLayers()` and `syncAllData()` calls with `<MapRenderer map={mapInstance} />`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/MapRenderer.tsx src/components/studio/StudioCanvas.tsx
git commit -m "refactor(studio): create MapRenderer — reads CampusDocument, renders GeoJSON on MapLibre"
```

---

### Task 10: Rewrite StudioCanvas as Composition Root

**Files:**
- Rewrite: `src/components/studio/StudioCanvas.tsx`
- Modify: `src/components/studio/StudioWorkspace.tsx` (if needed)

- [ ] **Step 1: Write StudioCanvas as composition root**

```typescript
'use client'

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useStudioStore } from '@/store/studio-store'
import {
  useDrawingSession,
  DrawingSessionProvider,
} from './useDrawingSession'
import { ViewportController } from './ViewportController'
import { MapRenderer } from './MapRenderer'
import { InteractionController } from './InteractionController'
import { useToolController } from './useToolController'
import { SelectionOverlay } from './SelectionOverlay'
import { DrawingOverlay } from './DrawingOverlay'
import { PreviewOverlay } from './PreviewOverlay'
import { ConfirmBar } from './ConfirmBar'

const FALLBACK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background' as const,
      paint: { 'background-color': '#1a1a2e' },
    },
  ],
}

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' as const }],
}

const SATELLITE_STYLE = { /* ... keep existing definition ... */ }

function getInitialStyle() {
  if (typeof window !== 'undefined') return OSM_STYLE
  return FALLBACK_STYLE
}

interface StudioCanvasProps {
  center?: { lat: number; lng: number }
}

export function StudioCanvas({ center }: StudioCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const drawing = useDrawingSession()

  // Create map once
  useEffect(() => {
    const c = center ?? { lat: 11.8195, lng: 122.0922 }
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style: getInitialStyle(),
      center: [c.lng, c.lat],
      zoom: 17,
    })

    map.on('load', () => {
      setMapInstance(map)
    })

    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tool cursor and drag mode
  const tool = useStudioStore((s) => s.tool)
  useEffect(() => {
    if (!mapInstance) return
    const canvas = mapInstance.getCanvas()
    if (tool === 'route' || tool === 'room' || tool === 'asset' || tool === 'boundary' || tool === 'building') {
      canvas.style.cursor = 'crosshair'
      mapInstance.dragPan.disable()
    } else if (tool === 'select') {
      canvas.style.cursor = 'pointer'
      mapInstance.dragPan.enable()
    } else {
      canvas.style.cursor = ''
      mapInstance.dragPan.enable()
    }
  }, [mapInstance, tool])

  // Layer visibility
  const layers = useStudioStore((s) => s.layers)
  useEffect(() => {
    if (!mapInstance) return
    const setVis = (layerId: string, visible: boolean) => {
      try {
        mapInstance.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
      } catch { /* layer may not exist */ }
    }
    setVis('l-nodes', layers.nodes)
    setVis('l-nodes-connection', layers.nodes)
    setVis('l-edges', layers.edges)
    setVis('l-buildings-fill', layers.buildings)
    setVis('l-buildings-extrusion', layers.buildings)
    setVis('l-buildings-outline', layers.buildings)
  }, [mapInstance, layers])

  // Satellite toggle
  useEffect(() => {
    if (!mapInstance) return
    const currentStyle = mapInstance.getStyle()
    const isSatellite = currentStyle?.sources?.satellite != null
    if (layers.satellite === isSatellite) return
    const targetStyle = layers.satellite ? SATELLITE_STYLE : OSM_STYLE
    mapInstance.setStyle(targetStyle)
    mapInstance.once('style.load', () => {
      setMapInstance(mapInstance)
    })
  }, [mapInstance, layers.satellite])

  useToolController()

  const confirm = () => {
    const points = drawing.confirm()
    // ToolController will handle command dispatch
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      {mapInstance && (
        <DrawingSessionProvider value={drawing}>
          <ViewportController map={mapInstance} initialCenter={center} />
          <MapRenderer map={mapInstance} />
          <InteractionController map={mapInstance} />
          <SelectionOverlay map={mapInstance} />
          <DrawingOverlay map={mapInstance} />
          <PreviewOverlay map={mapInstance} />
          <ConfirmBar
            tracePoints={drawing.tracePoints}
            drawPoints={drawing.drawPoints}
            routeWidth={drawing.routeWidth}
            tool={tool}
            canConfirm={drawing.canConfirm}
            onConfirm={drawing.requestConfirm}
            onCancel={drawing.cancel}
            onUndo={drawing.undoLastPoint}
            onSetWidth={drawing.setRouteWidth}
            toolLabel={
              tool === 'route' ? 'Campus route' :
              tool === 'building' ? 'Building footprint' :
              tool === 'boundary' ? 'Campus boundary' : ''
            }
          />
        </DrawingSessionProvider>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS — all 797+ existing tests + new tests

- [ ] **Step 3: Verify final StudioCanvas line count**

```bash
Get-Content src/components/studio/StudioCanvas.tsx | Measure-Object -Line
```
Expected: ≤250 lines

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/StudioCanvas.tsx
git commit -m "refactor(studio): rewrite StudioCanvas as composition root (~200 lines)"
```

---

### Task 11: Integration Tests

**Files:**
- Create: `src/components/studio/__tests__/StudioCanvas.test.tsx`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { StudioCanvas } from '../StudioCanvas'

// Mock MapLibre GL
vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      getSource: vi.fn(),
      getCanvas: vi.fn(() => ({ style: {} })),
      setLayoutProperty: vi.fn(),
      dragPan: { enable: vi.fn(), disable: vi.fn() },
      getStyle: vi.fn(() => ({ sources: {}, layers: [] })),
      setStyle: vi.fn(),
      once: vi.fn(),
      flyTo: vi.fn(),
      fitBounds: vi.fn(),
      easeTo: vi.fn(),
      project: vi.fn(() => ({ x: 0, y: 0 })),
      queryRenderedFeatures: vi.fn(() => []),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getCanvasContainer: vi.fn(() => document.createElement('div')),
      setFeatureState: vi.fn(),
    })),
  },
}))

describe('StudioCanvas integration', () => {
  it('renders without crashing', () => {
    const { container } = render(<StudioCanvas />)
    expect(container.querySelector('[style*="position: relative"]')).toBeDefined()
  })

  it('creates a MapLibre map container', () => {
    const { container } = render(<StudioCanvas />)
    const mapDiv = container.querySelector('[style*="width: 100%"][style*="height: 100%"]')
    expect(mapDiv).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/studio/__tests__/StudioCanvas.test.tsx
git commit -m "test(studio): add StudioCanvas integration test"
```

---

### Task 12: Legacy State Cleanup (Optional)

**Files:**
- Modify: `src/store/studio-store.ts`

- [ ] **Step 1: Remove migrated state**

Remove `tracePoints`, `drawPoints`, `routeWidth`, `pendingConfirm`, `selectedTraceId` and their associated actions from `studio-store.ts`, since these are now owned by `useDrawingSession`.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/studio-store.ts
git commit -m "chore(studio): remove migrated drawing state from legacy studio-store"
```
