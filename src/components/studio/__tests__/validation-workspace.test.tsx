import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CoordinateTransformer } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import { Graph } from '@/engine/graph'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'

const mocks = vi.hoisted(() => ({
  context: null as any,
  selection: null as any,
  snapshot: null as any,
  validationEngine: null as any,
  dispatcher: { execute: vi.fn() },
  workflow: { save: vi.fn() },
  viewport: { flyTo: vi.fn(), fitBounds: vi.fn() },
}))

vi.mock('@navi/editor', () => ({
  PropertiesPanel: () => <div data-testid="properties">PropertiesPanel</div>,
  ProblemsPanel: (props: { onIssueFocus?: (issue: any) => void; canIssueFocus?: (issue: any) => boolean }) => {
    const roomIssue = {
      issueId: 'room-issue',
      ruleId: 'polygon-closure',
      severity: 'error',
      message: 'Room geometry issue',
      targets: [{ entityId: 'room-1', entityType: 'room' }],
      buildingId: 'building-1',
      floorId: 'floor-0',
      layer: 'architecture',
    }
    const routeIssue = {
      issueId: 'route-issue',
      ruleId: 'route-network-disconnected',
      severity: 'warning',
      message: 'Route is disconnected',
      targets: [{ entityId: 'route-node-1', entityType: 'route-node' }],
      buildingId: 'building-1',
      floorId: 'floor-0',
      layer: 'navigation',
    }
    return (
      <div data-testid="problems">
        <button onClick={() => props.onIssueFocus?.(roomIssue)}>Focus room issue</button>
        <button
          disabled={props.canIssueFocus ? !props.canIssueFocus(routeIssue) : false}
          onClick={() => props.onIssueFocus?.(routeIssue)}
        >
          Focus route issue
        </button>
      </div>
    )
  },
  useEditor: () => mocks.context,
  useSelection: () => mocks.selection,
}))

vi.mock('../StudioCanvas', () => ({
  StudioCanvas: (props: { onEmptyMapClick?: () => void }) => (
    <button data-testid="map-empty" onClick={props.onEmptyMapClick}>StudioCanvas</button>
  ),
}))
vi.mock('../SaveStatus', () => ({ SaveStatus: () => <div>SaveStatus</div> }))
vi.mock('../ToolDock', () => ({ ToolDock: () => <div>ToolDock</div> }))
vi.mock('../ExplorerPanel', () => ({ ExplorerPanel: () => <div>ExplorerPanel</div> }))
vi.mock('../ConfirmOverlay', () => ({ ConfirmOverlay: () => <div>ConfirmOverlay</div> }))
vi.mock('../BuildStatus', () => ({
  BuildStatus: (props: { onOpenProblems?: () => void; problemCount?: number }) => (
    <div>
      <span>BuildStatus</span>
      <button onClick={props.onOpenProblems}>View issues{props.problemCount ? ` (${props.problemCount})` : ''}</button>
    </div>
  ),
}))

import { StudioWorkspace } from '../StudioWorkspace'

function createDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'campus-1',
      name: 'Test campus',
      description: '',
      lastModified: '2026-08-31T00:00:00.000Z',
      editorVersion: 'test',
    },
    buildings: [{
      id: 'building-1',
      name: 'Test building',
      code: 'TB',
      category: 'academic',
      description: '',
      footprint: { points: [
        { lat: 10, lng: 20 },
        { lat: 10, lng: 20.001 },
        { lat: 10.001, lng: 20.001 },
        { lat: 10, lng: 20 },
      ] },
      baseElevation: 0,
      height: 10,
      floors: [{
        id: 'floor-0',
        level: 0,
        label: 'Ground floor',
        elevation: 0,
        height: 3.5,
        rooms: [{
          id: 'room-1',
          name: 'Room 1',
          number: '101',
          category: 'other',
          polygon: { points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 0 }] },
          roomDoors: [],
          metadata: {},
        }],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
      }],
      verticalConnectors: [],
      color: '#ffffff',
      aliases: [],
      metadata: {},
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function prepareHarness() {
  const document = createDocument()
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({ buildingId: 'building-1', origin: { lat: 10, lng: 20 }, rotation: 0 })
  const listeners = new Set<(snapshot: any) => void>()
  mocks.snapshot = {
    epoch: 1,
    documentId: 'campus-1',
    documentVersion: 1,
    profile: 'publish',
    validatedAt: 1,
    state: 'errors',
    issues: [{ issueId: 'existing', ruleId: 'route-network-disconnected', severity: 'error', message: 'Existing issue', targets: [] }],
    statistics: { duration: 1, totalIssues: 1, errors: 1, warnings: 0, infos: 0, rulesExecuted: 1, rulesReused: 0, rulesPassed: 0, rulesFailed: 1 },
    analysisCache: {},
  }
  mocks.validationEngine = {
    getLastSnapshot: vi.fn(() => mocks.snapshot),
    onValidationUpdated: vi.fn((callback: (snapshot: any) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }),
  }
  mocks.selection = {
    lastSelected: null,
    select: vi.fn(),
  }
  mocks.context = {
    document,
    transformer,
    services: {
      get(name: string) {
        if (name === 'validationEngine') return mocks.validationEngine
        if (name === 'publishStore') return { getSnapshot: () => ({ publishState: 'idle', publishError: null }), subscribe: () => () => undefined }
        if (name === 'publish') return { publish: vi.fn() }
        if (name === 'dispatcher') return mocks.dispatcher
        if (name === 'workflow') return mocks.workflow
        if (name === 'viewport') return mocks.viewport
        return undefined
      },
    },
  }
  return { document, listeners }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useStudioStore.setState({
    activeBuildingId: null,
    activeFloor: 0,
    selectedNodeId: null,
    selectedTraceId: null,
    validationFocus: null,
  })
  useGraphStore.setState({ graph: new Graph(), currentMapId: null, renderVersion: 0 })
})

describe('StudioWorkspace validation issue focus', () => {
  it('shows Problems after validation even when no entity is selected', () => {
    prepareHarness()
    render(<StudioWorkspace mapId="campus-1" />)
    expect(screen.getByTestId('problems')).toBeDefined()
  })

  it('toggles the issue report from the header action', () => {
    prepareHarness()
    render(<StudioWorkspace mapId="campus-1" />)
    expect(screen.getByTestId('problems')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /View issues/ }))
    expect(screen.queryByTestId('problems')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /View issues/ }))
    expect(screen.getByTestId('problems')).toBeDefined()
  })

  it('closes the issue report when the map reports an empty click', () => {
    prepareHarness()
    render(<StudioWorkspace mapId="campus-1" />)
    expect(screen.getByTestId('problems')).toBeDefined()

    fireEvent.click(screen.getByTestId('map-empty'))

    expect(screen.queryByTestId('problems')).toBeNull()
  })

  it('closes the issue report when a different component becomes selected', () => {
    prepareHarness()
    const view = render(<StudioWorkspace mapId="campus-1" />)
    expect(screen.getByTestId('problems')).toBeDefined()

    mocks.selection.lastSelected = { type: 'building', id: 'building-1' }
    view.rerender(<StudioWorkspace mapId="campus-1" />)

    expect(screen.queryByTestId('problems')).toBeNull()
  })

  it('keeps the issue report open when Show on map selects the issue target', () => {
    prepareHarness()
    const view = render(<StudioWorkspace mapId="campus-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Focus room issue' }))
    mocks.selection.lastSelected = {
      type: 'room',
      id: 'room-1',
      buildingId: 'building-1',
      floorId: 'floor-0',
    }
    view.rerender(<StudioWorkspace mapId="campus-1" />)

    expect(screen.getByTestId('problems')).toBeDefined()
  })

  it('focuses an authored room with its complete selector and camera bounds', () => {
    prepareHarness()
    render(<StudioWorkspace mapId="campus-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Focus room issue' }))

    expect(mocks.selection.select).toHaveBeenCalledWith({
      type: 'room',
      id: 'room-1',
      buildingId: 'building-1',
      floorId: 'floor-0',
    })
    expect(mocks.viewport.fitBounds).toHaveBeenCalledTimes(1)
    expect(useStudioStore.getState().validationFocus?.targetId).toBe('room-1')
    expect(mocks.dispatcher.execute).not.toHaveBeenCalled()
    expect(mocks.workflow.save).not.toHaveBeenCalled()
  })

  it('focuses a route node through compatibility state and the temporary overlay', () => {
    prepareHarness()
    const graph = new Graph()
    graph.addNode({
      id: 'route-node-1',
      label: 'Route point',
      position: { lat: 10.002, lng: 20.002 },
      floor: 0,
      buildingId: 'building-1',
      campusId: 'campus-1',
      type: 'walkway',
    })
    useGraphStore.setState({ graph })

    const view = render(<StudioWorkspace mapId="campus-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Focus route issue' }))

    // SelectionBridge can expose the focused building before the compatibility
    // route-node state settles; that transition must not close the report.
    mocks.selection.lastSelected = { type: 'building', id: 'building-1' }
    view.rerender(<StudioWorkspace mapId="campus-1" />)

    expect(useStudioStore.getState().selectedNodeId).toBe('route-node-1')
    expect(useStudioStore.getState().selectedTraceId).toBeNull()
    expect(useStudioStore.getState().validationFocus).toMatchObject({ targetId: 'route-node-1', targetType: 'route-node' })
    expect(mocks.viewport.flyTo).toHaveBeenCalledTimes(1)
    expect(mocks.selection.select).not.toHaveBeenCalled()
    expect(mocks.dispatcher.execute).not.toHaveBeenCalled()
    expect(mocks.workflow.save).not.toHaveBeenCalled()
    expect(screen.getByTestId('problems')).toBeDefined()
  })
})
