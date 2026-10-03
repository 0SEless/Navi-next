import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useStudioStore } from '@/store/studio-store'
import type { ValidationFocus } from '../validation-focus'
import { ValidationIssueOverlay } from '../ValidationIssueOverlay'
import { LYR, SRC } from '../rendering/constants'

type Source = {
  data: GeoJSON.FeatureCollection
  setData: (data: GeoJSON.FeatureCollection) => void
}

function createMapDouble() {
  const sources = new Map<string, Source>()
  const layers = new Set<string>()
  const listeners = new Map<string, Set<() => void>>()

  const map = {
    getSource: (id: string) => sources.get(id) ?? null,
    addSource: (id: string, definition: { data: GeoJSON.FeatureCollection }) => {
      const source: Source = {
        data: definition.data,
        setData(data) { source.data = data },
      }
      sources.set(id, source)
    },
    getLayer: (id: string) => layers.has(id) ? { id } : null,
    addLayer: (definition: { id: string }) => { layers.add(definition.id) },
    on: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    },
    off: (event: string, handler: () => void) => { listeners.get(event)?.delete(handler) },
  }

  return {
    map,
    sources,
    layers,
    reloadStyle() {
      sources.clear()
      layers.clear()
      for (const handler of listeners.get('style.load') ?? []) handler()
    },
  }
}

const focus: ValidationFocus = {
  issueId: 'issue-1',
  targetId: 'route-edge-1',
  targetType: 'route-edge',
  buildingId: 'building-1',
  floor: 0,
  layer: 'navigation',
  geometry: {
    kind: 'line',
    points: [
      { lat: 10, lng: 20 },
      { lat: 10.001, lng: 20.001 },
    ],
  },
}

afterEach(() => {
  cleanup()
  useStudioStore.setState({ validationFocus: null })
})

describe('ValidationIssueOverlay', () => {
  it('creates dedicated point/line/polygon layers and paints the focused geometry', () => {
    const harness = createMapDouble()
    render(<ValidationIssueOverlay map={harness.map as any} />)

    act(() => {
      useStudioStore.getState().setValidationFocus(focus)
    })

    const source = harness.sources.get(SRC.VALIDATION_FOCUS)
    expect(source?.data.features).toHaveLength(1)
    expect(source?.data.features[0].geometry.type).toBe('LineString')
    expect(harness.layers.has(LYR.VALIDATION_FOCUS_POINT)).toBe(true)
    expect(harness.layers.has(LYR.VALIDATION_FOCUS_LINE)).toBe(true)
    expect(harness.layers.has(LYR.VALIDATION_FOCUS_POLYGON_FILL)).toBe(true)
  })

  it('recreates and repaints the temporary focus after a style reload', () => {
    const harness = createMapDouble()
    render(<ValidationIssueOverlay map={harness.map as any} />)

    act(() => {
      useStudioStore.getState().setValidationFocus(focus)
    })
    act(() => {
      harness.reloadStyle()
    })

    expect(harness.sources.get(SRC.VALIDATION_FOCUS)?.data.features).toHaveLength(1)
    expect(harness.layers.has(LYR.VALIDATION_FOCUS_LINE)).toBe(true)
  })

  it('clears the temporary source when focus is removed without dispatching a document change', () => {
    const harness = createMapDouble()
    render(<ValidationIssueOverlay map={harness.map as any} />)

    act(() => {
      useStudioStore.getState().setValidationFocus(focus)
    })
    act(() => {
      useStudioStore.getState().setValidationFocus(null)
    })

    expect(harness.sources.get(SRC.VALIDATION_FOCUS)?.data.features).toHaveLength(0)
  })
})
