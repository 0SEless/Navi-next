import { describe, it, expect, beforeEach } from 'vitest'
import { SelectionManager } from './selection'
import { DocumentEventBus } from './eventbus'
import { SelectionOrigin } from './context/entity-id'
import type { CampusDocument } from '@navi/core'
import type { EntitySelector, SelectionMode } from './context/entity-id'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [
      { id: 'bld-1', name: 'A', code: 'A', category: 'academic', description: '', footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] }, baseElevation: 0, height: 10, floors: [], color: '#000', aliases: [], metadata: {} },
      { id: 'bld-2', name: 'B', code: 'B', category: 'library', description: '', footprint: { points: [{ lat: 2, lng: 2 }] }, baseElevation: 0, height: 10, floors: [], color: '#fff', aliases: [], metadata: {} },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('SelectionManager', () => {
  let selection: SelectionManager
  let eventBus: DocumentEventBus
  let document: CampusDocument

  beforeEach(() => {
    document = createDoc()
    eventBus = new DocumentEventBus()
    selection = new SelectionManager(document, eventBus)
  })

  it('starts empty', () => {
    expect(selection.count).toBe(0)
    expect(selection.lastSelectedId).toBeNull()
    expect(selection.lastSelectedSelector).toBeNull()
  })

  it('selects an entity by string id', () => {
    selection.select('bld-1')
    expect(selection.isSelected('bld-1')).toBe(true)
    expect(selection.count).toBe(1)
    expect(selection.lastSelectedId).toBe('bld-1')
  })

  it('select replaces previous selection', () => {
    selection.select('bld-1')
    selection.select('bld-2')
    expect(selection.isSelected('bld-1')).toBe(false)
    expect(selection.isSelected('bld-2')).toBe(true)
    expect(selection.count).toBe(1)
  })

  it('toggle adds to selection', () => {
    selection.toggle('bld-1')
    selection.toggle('bld-2')
    expect(selection.count).toBe(2)
  })

  it('toggle removes if already selected', () => {
    selection.toggle('bld-1')
    selection.toggle('bld-2')
    selection.toggle('bld-1')
    expect(selection.count).toBe(1)
    expect(selection.isSelected('bld-2')).toBe(true)
  })

  it('clear empties selection', () => {
    selection.select('bld-1')
    selection.clear()
    expect(selection.count).toBe(0)
    expect(selection.lastSelectedId).toBeNull()
    expect(selection.lastSelectedSelector).toBeNull()
  })

  it('resetOnToolChange clears everything', () => {
    selection.select('bld-1')
    selection.setHover('bld-2')
    selection.resetOnToolChange()
    expect(selection.count).toBe(0)
    expect(selection.hoveredEntityId).toBeNull()
    expect(selection.hoveredSelector).toBeNull()
  })

  it('emits selection.changed event', () => {
    let emitted: any = null
    eventBus.on('selection.changed', (s) => { emitted = s })
    selection.select('bld-1')
    expect(emitted).not.toBeNull()
    expect(emitted.entityIds).toEqual(['bld-1'])
  })

  it('boundingBox returns null when empty', () => {
    expect(selection.boundingBox).toBeNull()
  })
})

// ── New M2.1 functionality ────────────────────────────────────

describe('SelectionManager — M2.1 extensions', () => {
  let selection: SelectionManager
  let eventBus: DocumentEventBus
  let document: CampusDocument

  beforeEach(() => {
    document = createDoc()
    eventBus = new DocumentEventBus()
    selection = new SelectionManager(document, eventBus)
  })

  describe('mode', () => {
    it('defaults to single', () => {
      expect(selection.mode).toBe('single')
    })

    it('setMode changes mode', () => {
      selection.setMode('multi')
      expect(selection.mode).toBe('multi')
      selection.setMode('marquee')
      expect(selection.mode).toBe('marquee')
      selection.setMode('single')
      expect(selection.mode).toBe('single')
    })
  })

  describe('origin', () => {
    it('select with origin stores it', () => {
      selection.select('bld-1', SelectionOrigin.Explorer)
      expect(selection.origin).toBe('explorer')
      expect(selection.isSelected('bld-1')).toBe(true)
    })

    it('select without origin defaults to canvas', () => {
      selection.select('bld-1')
      expect(selection.origin).toBe('canvas')
    })

    it('toggle with origin stores it', () => {
      selection.toggle('bld-1', SelectionOrigin.Explorer)
      expect(selection.origin).toBe('explorer')
    })

    it('clear with origin stores it', () => {
      selection.clear(SelectionOrigin.Keyboard)
      expect(selection.origin).toBe('keyboard')
    })
  })

  describe('selectors', () => {
    it('select by string creates a default building selector', () => {
      selection.select('bld-1')
      const selectors = selection.selectors
      expect(selectors).toHaveLength(1)
      expect(selectors[0].type).toBe('building')
      expect(selectors[0].id).toBe('bld-1')
    })

    it('select by EntitySelector preserves the selector', () => {
      const sel: EntitySelector = { type: 'road', id: 'rd-1' as any }
      selection.select(sel, SelectionOrigin.Explorer)
      expect(selection.selectors).toHaveLength(1)
      expect(selection.selectors[0]).toEqual(sel)
      expect(selection.lastSelectedSelector).toEqual(sel)
    })

    it('selectionState returns full enriched state', () => {
      const sel: EntitySelector = { type: 'road', id: 'rd-1' as any }
      selection.select(sel, SelectionOrigin.Explorer)
      selection.setMode('multi')

      const state = selection.selectionState
      expect(state.selected).toHaveLength(1)
      expect(state.selected[0]).toEqual(sel)
      expect(state.mode).toBe('multi')
      expect(state.origin).toBe('explorer')
      expect(state.hovered).toBeNull()
      expect(state.lastSelected).toEqual(sel)
    })
  })

  describe('onChange listener', () => {
    it('notifies listeners on select', () => {
      let called = 0
      const unsub = selection.onChange(() => { called++ })
      selection.select('bld-1')
      expect(called).toBe(1)
      unsub()
      selection.select('bld-2')
      expect(called).toBe(1) // unsubscribed
    })

    it('notifies listeners on toggle', () => {
      let called = 0
      selection.onChange(() => { called++ })
      selection.toggle('bld-1')
      expect(called).toBe(1)
    })

    it('notifies listeners on clear', () => {
      let called = 0
      selection.onChange(() => { called++ })
      selection.clear()
      expect(called).toBe(1)
    })
  })

  describe('hover', () => {
    it('setHover with string id', () => {
      selection.setHover('bld-1')
      expect(selection.hoveredEntityId).toBe('bld-1')
      expect(selection.hoveredSelector).not.toBeNull()
      expect(selection.hoveredSelector!.type).toBe('building')
    })

    it('setHover with EntitySelector', () => {
      const sel: EntitySelector = { type: 'floor', id: 'f1' as any, buildingId: 'b1' as any }
      selection.setHover(sel)
      expect(selection.hoveredSelector).toEqual(sel)
    })

    it('setHover null clears hover', () => {
      selection.setHover('bld-1')
      selection.setHover(null)
      expect(selection.hoveredEntityId).toBeNull()
      expect(selection.hoveredSelector).toBeNull()
    })
  })
})

describe('SelectionManager — P1-T6 door selection (R15.1 provenance)', () => {
  let selection: SelectionManager
  let eventBus: DocumentEventBus

  beforeEach(() => {
    eventBus = new DocumentEventBus()
    selection = new SelectionManager(createDoc(), eventBus)
  })

  it('selecting a DoorSelector preserves type "door" — never coerced to the owning room or building', () => {
    const doorSelector: EntitySelector = {
      type: 'door',
      id: 'door-1' as never,
      buildingId: 'bld-1' as never,
      floorId: 'flr-0' as never,
      roomId: 'room-1' as never,
    }
    selection.select(doorSelector)
    const state = selection.selectionState
    expect(state.selected).toHaveLength(1)
    expect(state.selected[0].type).toBe('door')
    expect((state.selected[0] as { roomId?: string }).roomId).toBe('room-1')
    expect(state.lastSelected?.type).toBe('door')
  })

  it('a raw string id still resolves to a building selector (existing behavior unchanged)', () => {
    selection.select('door-2')
    expect(selection.selectionState.selected[0].type).toBe('building')
  })
})
