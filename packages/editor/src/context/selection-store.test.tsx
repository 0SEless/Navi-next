import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EditorProvider } from './editor-context'
import { ServiceRegistry } from './service-registry'
import { SelectionManager } from '../selection'
import { DocumentEventBus } from '../eventbus'
import { SelectionOrigin } from './entity-id'
import { useSelection } from './selection-store'
import type { CampusDocument } from '@navi/core'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [
      { id: 'bld-1', name: 'A', code: 'A', category: 'academic', description: '', footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] }, baseElevation: 0, height: 10, floors: [], color: '#000', aliases: [], metadata: {} },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function setupServices() {
  const doc = createDoc()
  const eventBus = new DocumentEventBus()
  const selection = new SelectionManager(doc, eventBus)
  const registry = new ServiceRegistry()
  registry.register('eventBus', eventBus)
  registry.register('selection', selection)
  return { doc, eventBus, selection, registry }
}

function createWrapper(registry: ServiceRegistry, doc: CampusDocument) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <EditorProvider context={{ document: doc, services: registry }}>
        {children}
      </EditorProvider>
    )
  }
}

describe('useSelection', () => {
  it('returns initial empty state', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    expect(result.current.selected).toEqual([])
    expect(result.current.hovered).toBeNull()
    expect(result.current.mode).toBe('single')
    expect(result.current.lastSelected).toBeNull()
  })

  it('select updates state reactively', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    act(() => {
      result.current.select('bld-1')
    })

    expect(result.current.selected).toHaveLength(1)
    expect(result.current.selected[0].id).toBe('bld-1')
    expect(result.current.origin).toBe('canvas')
  })

  it('select with Explorer origin', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    act(() => {
      result.current.select('bld-1', SelectionOrigin.Explorer)
    })

    expect(result.current.origin).toBe('explorer')
  })

  it('clear empties selection', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    act(() => {
      result.current.select('bld-1')
    })
    expect(result.current.selected).toHaveLength(1)

    act(() => {
      result.current.clear()
    })
    expect(result.current.selected).toHaveLength(0)
  })

  it('toggle adds and removes', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    act(() => { result.current.toggle('bld-1') })
    expect(result.current.selected).toHaveLength(1)

    act(() => { result.current.toggle('bld-1') })
    expect(result.current.selected).toHaveLength(0)
  })

  it('setMode updates mode', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    act(() => { result.current.setMode('multi') })
    expect(result.current.mode).toBe('multi')
  })

  it('setHover updates hover state', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    act(() => { result.current.setHover('bld-1') })
    expect(result.current.hovered).not.toBeNull()
    expect(result.current.hovered!.id).toBe('bld-1')

    act(() => { result.current.clearHover() })
    expect(result.current.hovered).toBeNull()
  })

  it('isSelected checks selection', () => {
    const { selection, registry, doc } = setupServices()
    const { result } = renderHook(() => useSelection(), {
      wrapper: createWrapper(registry, doc),
    })

    expect(result.current.isSelected('bld-1')).toBe(false)
    act(() => { result.current.select('bld-1') })
    expect(result.current.isSelected('bld-1')).toBe(true)
  })
})
