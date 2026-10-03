import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExplorerView } from '../useExplorerView'
import type { ExplorerNode, EntityId } from '@navi/editor'

const asEntityId = (s: string) => s as unknown as EntityId

function buildTree(): ExplorerNode[] {
  return [{
    id: asEntityId('root'),
    label: 'Campus',
    type: 'campus',
    entitySelector: { type: 'building', id: asEntityId('root') },
    children: [
      {
        id: asEntityId('bld-1'),
        label: 'Library',
        type: 'building',
        entitySelector: { type: 'building', id: asEntityId('bld-1') },
        children: [
          {
            id: asEntityId('flr-1'),
            label: 'Floor 1',
            type: 'floor',
            entitySelector: { type: 'floor', id: asEntityId('flr-1'), buildingId: asEntityId('bld-1') },
            children: [
              {
                id: asEntityId('rm-101'),
                label: 'Room 101',
                type: 'room',
                entitySelector: { type: 'room', id: asEntityId('rm-101'), buildingId: asEntityId('bld-1'), floorId: asEntityId('flr-1') },
                children: [],
              },
              {
                id: asEntityId('rm-102'),
                label: 'Room 102',
                type: 'room',
                entitySelector: { type: 'room', id: asEntityId('rm-102'), buildingId: asEntityId('bld-1'), floorId: asEntityId('flr-1') },
                children: [],
              },
            ],
          },
        ],
      },
      {
        id: asEntityId('bld-2'),
        label: 'Gym',
        type: 'building',
        entitySelector: { type: 'building', id: asEntityId('bld-2') },
        children: [],
      },
    ],
  }]
}

describe('useExplorerView', () => {
  it('returns full tree when no search query', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    expect(result.current.filteredTree).toHaveLength(1)
    expect(result.current.filteredTree[0].children).toHaveLength(2)
    expect(result.current.matchCount).toBe(0)
  })

  it('filters to matching nodes preserving hierarchy and siblings', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    act(() => result.current.setSearchQuery('Gym'))
    expect(result.current.matchCount).toBe(1)
    const root = result.current.filteredTree[0]
    expect(root.label).toBe('Campus')
    // Gym is visible (match), Library is shown as sibling of Gym
    expect(root.children).toHaveLength(2)
    const library = root.children![0]
    expect(library.label).toBe('Library')
    // Library's children should NOT be visible (no match inside)
    expect(library.children).toBeUndefined()
  })

  it('search shows ancestor chain, path siblings, and nested children', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    act(() => result.current.setSearchQuery('Room 101'))
    expect(result.current.matchCount).toBe(1)
    const root = result.current.filteredTree[0]
    expect(root.label).toBe('Campus')
    expect(root.children).toHaveLength(2) // Library + Gym (siblings of ancestor)

    const library = root.children![0]
    expect(library.label).toBe('Library')
    expect(library.children).toHaveLength(1) // Only Floor 1 (ancestor of match)

    const floor1 = library.children![0]
    expect(floor1.label).toBe('Floor 1')
    // Both Room 101 (match) and Room 102 (sibling of match) are visible
    expect(floor1.children).toHaveLength(2)
    expect(floor1.children![0].label).toBe('Room 101')
    expect(floor1.children![1].label).toBe('Room 102')
  })

  it('toggleExpanded adds and removes ids', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    act(() => result.current.toggleExpanded(asEntityId('bld-1')))
    expect(result.current.expandedIds.has(asEntityId('bld-1'))).toBe(true)
    act(() => result.current.toggleExpanded(asEntityId('bld-1')))
    expect(result.current.expandedIds.has(asEntityId('bld-1'))).toBe(false)
  })

  it('expandAll adds all node ids', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    act(() => result.current.expandAll())
    expect(result.current.expandedIds.has(asEntityId('root'))).toBe(true)
    expect(result.current.expandedIds.has(asEntityId('bld-1'))).toBe(true)
    expect(result.current.expandedIds.has(asEntityId('flr-1'))).toBe(true)
  })

  it('collapseAll clears everything', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    act(() => result.current.expandAll())
    act(() => result.current.collapseAll())
    expect(result.current.expandedIds.size).toBe(0)
  })

  it('expandAncestors expands only ancestors of given ids', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    act(() => result.current.expandAncestors([asEntityId('rm-101')]))
    expect(result.current.expandedIds.has(asEntityId('root'))).toBe(true)
    expect(result.current.expandedIds.has(asEntityId('bld-1'))).toBe(true)
    expect(result.current.expandedIds.has(asEntityId('flr-1'))).toBe(true)
    // Should NOT expand bld-2 or rm-101 itself
    expect(result.current.expandedIds.has(asEntityId('bld-2'))).toBe(false)
    expect(result.current.expandedIds.has(asEntityId('rm-101'))).toBe(false)
  })

  it('returns full tree after search is cleared', () => {
    const { result } = renderHook(() => useExplorerView(buildTree()))
    act(() => result.current.setSearchQuery('Gym'))
    expect(result.current.matchCount).toBe(1)
    act(() => result.current.setSearchQuery(''))
    expect(result.current.matchCount).toBe(0)
    // Full tree restored
    expect(result.current.filteredTree[0].children).toHaveLength(2)
  })
})
