import { describe, it, expect } from 'vitest'
import { asEntityId, SelectionOrigin } from './entity-id'
import type { EntityId, EntitySelector, SelectionState } from './entity-id'

describe('EntityId', () => {
  it('asEntityId casts a string to EntityId', () => {
    const id: EntityId = asEntityId('bld-1')
    expect(id).toBe('bld-1')
    // EntityId is a string at runtime
    expect(typeof id).toBe('string')
  })

  it('EntityId is assignable to string', () => {
    const id = asEntityId('test')
    const str: string = id
    expect(str).toBe('test')
  })
})

describe('SelectionOrigin', () => {
  it('has all expected values', () => {
    expect(SelectionOrigin.Canvas).toBe('canvas')
    expect(SelectionOrigin.Explorer).toBe('explorer')
    expect(SelectionOrigin.Keyboard).toBe('keyboard')
    expect(SelectionOrigin.Programmatic).toBe('programmatic')
  })
})

describe('EntitySelector', () => {
  it('discriminates on type for building selector', () => {
    const sel: EntitySelector = { type: 'building', id: asEntityId('b1') }
    expect(sel.type).toBe('building')
    if (sel.type === 'building') {
      expect(sel.id).toBe('b1')
    }
  })

  it('discriminates on type for floor selector', () => {
    const sel: EntitySelector = { type: 'floor', id: asEntityId('f1'), buildingId: asEntityId('b1') }
    expect(sel.type).toBe('floor')
    if (sel.type === 'floor') {
      expect(sel.buildingId).toBe('b1')
    }
  })

  it('discriminates on type for room selector with floor and building ids', () => {
    const sel: EntitySelector = {
      type: 'room',
      id: asEntityId('r1'),
      buildingId: asEntityId('b1'),
      floorId: asEntityId('f1'),
    }
    expect(sel.type).toBe('room')
    if (sel.type === 'room') {
      expect(sel.floorId).toBe('f1')
    }
  })

  it('discriminates on type for road selector', () => {
    const sel: EntitySelector = { type: 'road', id: asEntityId('rd-1') }
    expect(sel.type).toBe('road')
  })

  it('discriminates on type for panorama selector', () => {
    const sel: EntitySelector = { type: 'panorama', id: asEntityId('pano-1') }
    expect(sel.type).toBe('panorama')
  })

  it('discriminates on type for qr selector', () => {
    const sel: EntitySelector = { type: 'qr', id: asEntityId('qr-1') }
    expect(sel.type).toBe('qr')
  })
})

describe('SelectionState', () => {
  it('can represent empty state', () => {
    const state: SelectionState = {
      selected: [],
      hovered: null,
      mode: 'single',
      origin: SelectionOrigin.Programmatic,
      lastSelected: null,
    }
    expect(state.selected).toHaveLength(0)
    expect(state.hovered).toBeNull()
    expect(state.lastSelected).toBeNull()
  })

  it('can represent single selection', () => {
    const sel: EntitySelector = { type: 'building', id: asEntityId('b1') }
    const state: SelectionState = {
      selected: [sel],
      hovered: null,
      mode: 'single',
      origin: SelectionOrigin.Canvas,
      lastSelected: sel,
    }
    expect(state.selected).toHaveLength(1)
    expect(state.selected[0]).toBe(sel)
    expect(state.origin).toBe('canvas')
  })

  it('can represent multi-selection', () => {
    const s1: EntitySelector = { type: 'building', id: asEntityId('b1') }
    const s2: EntitySelector = { type: 'building', id: asEntityId('b2') }
    const state: SelectionState = {
      selected: [s1, s2],
      hovered: null,
      mode: 'multi',
      origin: SelectionOrigin.Explorer,
      lastSelected: s2,
    }
    expect(state.selected).toHaveLength(2)
  })

  it('can represent hover state', () => {
    const hovered: EntitySelector = { type: 'room', id: asEntityId('r1'), buildingId: asEntityId('b1'), floorId: asEntityId('f1') }
    const state: SelectionState = {
      selected: [],
      hovered,
      mode: 'single',
      origin: SelectionOrigin.Programmatic,
      lastSelected: null,
    }
    expect(state.hovered).not.toBeNull()
    expect(state.hovered!.type).toBe('room')
    if (state.hovered?.type === 'room') {
      expect(state.hovered.floorId).toBe('f1')
    }
  })
})
