import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CampusDocument } from '@navi/core'
import { DocumentEventBus } from '../../eventbus'
import { EditorProvider } from '../../context'
import { SelectionManager } from '../../selection'
import { PropertiesPanel } from './PropertiesPanel'

afterEach(cleanup)

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1',
      name: 'Main',
      code: 'MAIN',
      category: 'academic',
      description: '',
      footprint: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121 }, { lat: 14, lng: 121 }] },
      baseElevation: 0,
      height: 20,
      color: '#4A90D9',
      aliases: [],
      metadata: {},
      verticalConnectors: [],
      floors: [{
        id: 'floor-1',
        level: 0,
        label: 'Ground',
        elevation: 0,
        height: 3.5,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        pois: [{ id: 'poi-1', name: 'Study Table', category: 'study_area', position: { x: 12, y: -4 } }],
      }],
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  } as CampusDocument
}

function renderPoiPanel(
  geometry?: { type: 'circle'; center: { x: number; y: number }; radius: number },
  appearance?: { mode: 'marker' | '2d' | '2.5d'; height?: number; color?: string },
) {
  const document = makeDocument()
  if (geometry) {
    const poi = document.buildings[0].floors[0].pois![0]
    document.buildings[0].floors[0].pois![0] = {
      ...poi,
      geometry,
      position: undefined,
      ...(appearance ? { appearance } : {}),
    } as any
  }
  const eventBus = new DocumentEventBus()
  const selection = new SelectionManager(document, eventBus)
  const execute = vi.fn()
  const services = {
    get(name: string) {
      if (name === 'selection') return selection
      if (name === 'eventBus') return eventBus
      if (name === 'dispatcher') return { execute }
      return undefined
    },
  }

  selection.select({
    type: 'poi',
    id: 'poi-1',
    buildingId: 'bld-1',
    floorId: 'floor-1',
  } as any)

  render(
    <EditorProvider context={{ document, services: services as any }}>
      <PropertiesPanel />
    </EditorProvider>,
  )

  return { execute }
}

describe('Phase 3A point POI Inspector', () => {
  it('renders the selected POI and updates through poi.update', () => {
    const { execute } = renderPoiPanel()

    expect(screen.getByText('POI')).toBeDefined()
    expect(screen.getByText('Position')).toBeDefined()
    fireEvent.change(screen.getByDisplayValue('Study Table'), { target: { value: 'Quiet Study Table' } })

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-1', patch: { name: 'Quiet Study Table' } },
    })
  })

  it('deletes the selected POI through poi.delete', () => {
    const { execute } = renderPoiPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Delete POI' }))

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.delete',
      label: 'Delete POI',
      payload: { poiId: 'poi-1' },
    })
  })

  it('shows the explicit geometry type while keeping the shared POI Inspector', () => {
    renderPoiPanel({ type: 'circle', center: { x: 12, y: -4 }, radius: 2.5 })

    expect(screen.getByText('Geometry')).toBeDefined()
    expect(screen.getByText('Circle')).toBeDefined()
    expect(screen.getByDisplayValue('Study Table')).toBeDefined()
  })

  it('shows the appearance mode and routes shape appearance changes through poi.update', () => {
    const { execute } = renderPoiPanel({ type: 'circle', center: { x: 12, y: -4 }, radius: 2.5 })
    const appearance = screen.getByRole('combobox', { name: 'Appearance' })

    expect(appearance).toHaveValue('2d')
    fireEvent.change(appearance, { target: { value: '2.5d' } })

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-1', patch: { appearance: { mode: '2.5d', height: 3.5 } } },
    })
  })

  it('keeps legacy point POIs on the disabled marker appearance', () => {
    renderPoiPanel()
    const appearance = screen.getByRole('combobox', { name: 'Appearance' })
    expect(appearance).toHaveValue('marker')
    expect(appearance).toBeDisabled()
  })

  it('shows height only for persisted 2.5D shapes', () => {
    const { execute } = renderPoiPanel(
      { type: 'circle', center: { x: 12, y: -4 }, radius: 2.5 },
      { mode: '2.5d', height: 4.25 },
    )
    expect(screen.getByRole('spinbutton', { name: 'Appearance height' })).toHaveValue(4.25)
    expect(execute).not.toHaveBeenCalled()
  })

  it('routes an authored color change through poi.update while preserving the mode', () => {
    const { execute } = renderPoiPanel(
      { type: 'circle', center: { x: 12, y: -4 }, radius: 2.5 },
      { mode: '2.5d', height: 4.25 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'POI color #8B4513' }))

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-1', patch: { appearance: { mode: '2.5d', height: 4.25, color: '#8B4513' } } },
    })
  })

  it('clears an authored color back to the default renderer color', () => {
    const { execute } = renderPoiPanel(
      { type: 'circle', center: { x: 12, y: -4 }, radius: 2.5 },
      { mode: '2d', color: '#22C55E' },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Default POI color' }))

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-1', patch: { appearance: { mode: '2d' } } },
    })
  })

  it('offers authored color for point POIs without changing marker-only mode', () => {
    const { execute } = renderPoiPanel()

    fireEvent.click(screen.getByRole('button', { name: 'POI color #EF4444' }))

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-1', patch: { appearance: { mode: 'marker', color: '#EF4444' } } },
    })
  })

  it('offers a custom color picker as the last color option', () => {
    const { execute } = renderPoiPanel()

    const picker = screen.getByLabelText('Custom POI color')
    expect(picker).toHaveAttribute('type', 'color')

    fireEvent.change(picker, { target: { value: '#1a2b3c' } })

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-1', patch: { appearance: { mode: 'marker', color: '#1A2B3C' } } },
    })
  })

  it('routes visibility changes through poi.update with both flags', () => {
    const { execute } = renderPoiPanel()
    expect(screen.getByRole('checkbox', { name: 'Show on map' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Searchable' })).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Searchable' }))

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-1', patch: { visibility: { showOnMap: true, searchable: false } } },
    })
  })
})

function renderOutdoorPoiPanel(
  geometry: { type: 'point'; position: { lat: number; lng: number } }
    | { type: 'circle'; center: { lat: number; lng: number }; radius: number },
  appearance?: { mode: 'marker' | '2d' | '2.5d'; height?: number },
  navigation?: { approachMode: 'automatic' | 'preferred'; anchor?: unknown },
) {
  const document = makeDocument()
  document.buildings[0].floors[0].pois = []
  document.pois = [{
    id: 'poi-outdoor-1',
    name: 'Guard Post',
    category: 'other',
    scope: 'outdoor',
    geometry,
    ...(appearance ? { appearance } : {}),
    ...(navigation ? { navigation } : {}),
  }] as CampusDocument['pois']

  const eventBus = new DocumentEventBus()
  const selection = new SelectionManager(document, eventBus)
  const execute = vi.fn()
  const services = {
    get(name: string) {
      if (name === 'selection') return selection
      if (name === 'eventBus') return eventBus
      if (name === 'dispatcher') return { execute }
      return undefined
    },
  }

  selection.select({ type: 'poi', id: 'poi-outdoor-1' } as any)

  render(
    <EditorProvider context={{ document, services: services as any }}>
      <PropertiesPanel />
    </EditorProvider>,
  )

  return { execute, eventBus }
}

describe('Outdoor/campus POI Inspector', () => {
  it('resolves the outdoor POI and shows world coordinates', () => {
    renderOutdoorPoiPanel({ type: 'point', position: { lat: 25.632842, lng: 122.927858 } })

    expect(screen.getByDisplayValue('Guard Post')).toBeDefined()
    expect(screen.getByText(/Outdoor · world coordinates/)).toBeDefined()
    expect(screen.getByText('Lat: 25.632842')).toBeDefined()
    expect(screen.getByText('Lng: 122.927858')).toBeDefined()
  })

  it('keeps outdoor points marker-only', () => {
    renderOutdoorPoiPanel({ type: 'point', position: { lat: 25.6, lng: 122.9 } })
    const appearance = screen.getByRole('combobox', { name: 'Appearance' })
    expect(appearance).toHaveValue('marker')
    expect(appearance).toBeDisabled()
  })

  it('allows 2D/2.5D appearance changes for outdoor shapes through poi.update', () => {
    const { execute } = renderOutdoorPoiPanel({ type: 'circle', center: { lat: 25.6, lng: 122.9 }, radius: 8 })
    const appearance = screen.getByRole('combobox', { name: 'Appearance' })

    expect(appearance).toHaveValue('2d')
    fireEvent.change(appearance, { target: { value: '2.5d' } })

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: 'poi-outdoor-1', patch: { appearance: { mode: '2.5d', height: 3.5 } } },
    })
  })

  it('deletes the outdoor POI through poi.delete', () => {
    const { execute } = renderOutdoorPoiPanel({ type: 'point', position: { lat: 25.6, lng: 122.9 } })

    fireEvent.click(screen.getByRole('button', { name: 'Delete POI' }))

    expect(execute).toHaveBeenCalledWith({
      id: 'poi.delete',
      label: 'Delete POI',
      payload: { poiId: 'poi-outdoor-1' },
    })
  })

  it('requests an anchor pick through the event bus for preferred approach', () => {
    const { eventBus } = renderOutdoorPoiPanel(
      { type: 'circle', center: { lat: 25.6, lng: 122.9 }, radius: 8 },
      undefined,
      { approachMode: 'preferred' },
    )
    const emit = vi.spyOn(eventBus, 'emit')

    fireEvent.click(screen.getByRole('button', { name: 'Pick approach anchor' }))

    expect(emit).toHaveBeenCalledWith('poi.anchor.pick', { poiId: 'poi-outdoor-1' })
  })
})
