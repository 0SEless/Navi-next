import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SelectionManager } from '../selection'
import { SelectionBridge } from './selection-bridge'
import { SelectionOrigin } from './entity-id'
import type { SelectionState } from './entity-id'
import type { CampusDocument } from '@navi/core'

// ── Mock CampusDocument ─────────────────────────────────────────
const mockDoc = {} as CampusDocument

function createSM() {
  const sm = new SelectionManager(mockDoc)
  // Manually init eventBus with a mock
  ;(sm as any).eventBus = { emit: vi.fn() }
  return sm
}

describe('SelectionBridge', () => {
  let sm: SelectionManager
  let bridge: SelectionBridge

  beforeEach(() => {
    sm = createSM()
    bridge = new SelectionBridge(sm)
  })

  it('throws if connected twice', () => {
    const target = { onSelectionChanged: vi.fn() }
    bridge.connect(target)
    expect(() => bridge.connect(target)).toThrow('already connected')
  })

  it('calls onSelectionChanged when selection changes', () => {
    const target = { onSelectionChanged: vi.fn() }
    bridge.connect(target)

    sm.select('bld-1')

    expect(target.onSelectionChanged).toHaveBeenCalledTimes(1)
    const [state, legacy] = target.onSelectionChanged.mock.calls[0]
    expect(state.selected).toHaveLength(1)
    expect(state.selected[0].id).toBe('bld-1')
    expect(legacy.selectedNodeId).toBe('bld-1')
  })

  it('does not loop on pushExternal -> select -> onChange cycle', () => {
    const target = { onSelectionChanged: vi.fn() }
    bridge.connect(target)
    target.onSelectionChanged.mockClear()

    // pushExternal sets syncing=true before calling sm.select(),
    // so the connected callback is suppressed — no loop.
    bridge.pushExternal(
      { type: 'building', id: 'bld-ext' },
      SelectionOrigin.Explorer,
    )

    expect(target.onSelectionChanged).toHaveBeenCalledTimes(0)
    expect(sm.selectedIds).toEqual(['bld-ext'])
  })

  it('pushExternal with null clears selection', () => {
    const target = { onSelectionChanged: vi.fn() }
    bridge.connect(target)
    target.onSelectionChanged.mockClear()

    sm.select('bld-1')
    expect(sm.selectedIds).toEqual(['bld-1'])

    bridge.pushExternal(null)
    expect(sm.selectedIds).toEqual([])
  })

  it('disconnect stops listening', () => {
    const target = { onSelectionChanged: vi.fn() }
    const unsub = bridge.connect(target)
    target.onSelectionChanged.mockClear()

    unsub()

    sm.select('bld-1')
    expect(target.onSelectionChanged).not.toHaveBeenCalled()
  })

  it('legacy.activeBuildingId from building selector', () => {
    const target = { onSelectionChanged: vi.fn() }
    bridge.connect(target)

    sm.select({ type: 'building', id: 'bld-alpha' })

    const [, legacy] = target.onSelectionChanged.mock.calls[0]
    expect(legacy.activeBuildingId).toBe('bld-alpha')
  })

  it('legacy.activeBuildingId from floor selector extracts buildingId', () => {
    const target = { onSelectionChanged: vi.fn() }
    bridge.connect(target)

    sm.select({ type: 'floor', id: 'flr-1', buildingId: 'bld-beta' })

    const [, legacy] = target.onSelectionChanged.mock.calls[0]
    expect(legacy.activeBuildingId).toBe('bld-beta')
  })

  it('legacy.selectedNodeId reflects current selection (single mode)', () => {
    const target = { onSelectionChanged: vi.fn() }
    bridge.connect(target)

    sm.select('bld-1')
    sm.select('bld-2')

    const [, legacy] = target.onSelectionChanged.mock.calls[1]
    expect(legacy.selectedNodeId).toBe('bld-2') // last selection replaces
  })

  it('isSyncing reflects sync state', () => {
    expect(bridge.isSyncing).toBe(false)
    bridge.pushExternal({ type: 'building', id: 'bld-1' })
    expect(bridge.isSyncing).toBe(false)
  })
})
