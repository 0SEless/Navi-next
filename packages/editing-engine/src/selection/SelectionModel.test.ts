import { describe, it, expect } from 'vitest'
import { createSelectionModel } from './SelectionModel'

describe('SelectionModel', () => {
  it('starts empty', () => {
    const s = createSelectionModel()
    expect(s.isEmpty).toBe(true)
    expect(s.size).toBe(0)
    expect(s.lastSelectedId).toBeNull()
  })

  it('selects a single id', () => {
    const s = createSelectionModel()
    s.select('a')
    expect(s.isSelected('a')).toBe(true)
    expect(s.size).toBe(1)
    expect(s.lastSelectedId).toBe('a')
  })

  it('select replaces previous selection', () => {
    const s = createSelectionModel()
    s.select('a')
    s.select('b')
    expect(s.isSelected('a')).toBe(false)
    expect(s.isSelected('b')).toBe(true)
    expect(s.size).toBe(1)
    expect(s.lastSelectedId).toBe('b')
  })

  it('deselect removes id and updates lastSelectedId', () => {
    const s = createSelectionModel()
    s.select('a')
    s.toggle('b')
    s.deselect('b')
    expect(s.isSelected('a')).toBe(true)
    expect(s.isSelected('b')).toBe(false)
    expect(s.lastSelectedId).toBe('a')
  })

  it('deselect of last item clears lastSelectedId', () => {
    const s = createSelectionModel()
    s.select('a')
    s.deselect('a')
    expect(s.isEmpty).toBe(true)
    expect(s.lastSelectedId).toBeNull()
  })

  it('toggle adds item not in selection', () => {
    const s = createSelectionModel()
    s.toggle('a')
    expect(s.isSelected('a')).toBe(true)
    expect(s.size).toBe(1)
  })

  it('toggle removes item already in selection', () => {
    const s = createSelectionModel()
    s.select('a')
    s.toggle('a')
    expect(s.isEmpty).toBe(true)
  })

  it('toggle adds to multi-selection', () => {
    const s = createSelectionModel()
    s.select('a')
    s.toggle('b')
    expect(s.isSelected('a')).toBe(true)
    expect(s.isSelected('b')).toBe(true)
    expect(s.size).toBe(2)
    expect(s.lastSelectedId).toBe('b')
  })

  it('selectMultiple sets multiple ids', () => {
    const s = createSelectionModel()
    s.selectMultiple(['a', 'b', 'c'])
    expect(s.size).toBe(3)
    expect(s.lastSelectedId).toBe('c')
  })

  it('clear removes all', () => {
    const s = createSelectionModel()
    s.selectMultiple(['a', 'b'])
    s.clear()
    expect(s.isEmpty).toBe(true)
    expect(s.lastSelectedId).toBeNull()
  })

  it('reset returns to initial state', () => {
    const s = createSelectionModel()
    s.select('a')
    s.reset()
    expect(s.isEmpty).toBe(true)
    expect(s.lastSelectedId).toBeNull()
  })

  it('snapshot captures current state', () => {
    const s = createSelectionModel()
    s.selectMultiple(['x', 'y'])
    const snap = s.snapshot()
    expect(snap.size).toBe(2)
    expect(snap.lastSelectedId).toBe('y')
    expect(snap.selectedIds.has('x')).toBe(true)
  })

  it('snapshot is immutable — mutations do not affect snapshot', () => {
    const s = createSelectionModel()
    s.select('a')
    const snap = s.snapshot()
    s.clear()
    expect(snap.size).toBe(1)
    expect(snap.lastSelectedId).toBe('a')
  })

  it('isSelected returns false for unselected id', () => {
    const s = createSelectionModel()
    expect(s.isSelected('nonexistent')).toBe(false)
  })

  it('selectMultiple with empty array clears selection', () => {
    const s = createSelectionModel()
    s.select('a')
    s.selectMultiple([])
    expect(s.isEmpty).toBe(true)
    expect(s.lastSelectedId).toBeNull()
  })

  it('deselect of unselected id is noop', () => {
    const s = createSelectionModel()
    s.select('a')
    s.deselect('b')
    expect(s.size).toBe(1)
    expect(s.lastSelectedId).toBe('a')
  })
})
