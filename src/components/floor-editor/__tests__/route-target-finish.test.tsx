import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFloorDrawing } from '../useFloorDrawing'

const mockExecute = vi.fn()
let mockDocument: any
let mockTransformer: any

vi.mock('@navi/editor', () => ({
  useEditor: () => ({
    document: mockDocument,
    transformer: mockTransformer,
    services: { get: () => ({ execute: mockExecute }) },
  }),
  findBuilding: (doc: any, buildingId: string) => doc.buildings.find((b: any) => b.id === buildingId) ?? null,
  genId: () => 'generated-id',
  snapPoint: (position: { x: number; y: number }) => ({ position }),
}))

const DEG = 111320
const ORIGIN = { lat: 11.8195, lng: 122.0922 }
mockTransformer = {
  worldToBuildingLocal: (p: { lat: number; lng: number }) => ({
    x: (p.lng - ORIGIN.lng) * DEG * Math.cos((ORIGIN.lat * Math.PI) / 180),
    y: (p.lat - ORIGIN.lat) * DEG,
  }),
  buildingLocalToWorld: (p: { x: number; y: number }) => ({
    lat: ORIGIN.lat + p.y / DEG,
    lng: ORIGIN.lng + p.x / (DEG * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  }),
}

function makeDoc() {
  return {
    buildings: [{
      id: 'BLD01',
      floors: [{
        id: 'flr-0',
        level: 0,
        routeNetwork: {
          nodes: [
            { id: 'n1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
            { id: 'n2', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
          ],
          edges: [{ id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 10 }],
        },
        entrances: [{ id: 'entrance-1', position: { lat: 11.8195, lng: 122.0910 }, level: 0 }],
      }],
    }],
  }
}

function createProbe() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const hits: unknown[] = []
  const map = {
    isStyleLoaded: vi.fn(() => true),
    getSource: vi.fn(() => null),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getLayer: vi.fn((id: string) => ({ id })),
    queryRenderedFeatures: vi.fn(() => hits),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler) }),
    off: vi.fn(),
    once: vi.fn(),
    dragPan: { disable: vi.fn(), enable: vi.fn() },
  } as unknown as import('maplibre-gl').Map
  return {
    map,
    setHits(next: unknown[]) { hits.length = 0; hits.push(...next) },
    click(lat: number, lng: number) {
      handlers.get('click')?.({ lngLat: { lat, lng }, point: { x: 0, y: 0 }, originalEvent: { detail: 1 } })
    },
  }
}

function renderRouteTool(probe: ReturnType<typeof createProbe>) {
  return renderHook(() => useFloorDrawing({
    map: probe.map, buildingId: 'BLD01', campusId: 'C1', floor: 0, tool: 'hallway', mapReady: true,
  }))
}

beforeEach(() => {
  mockDocument = makeDoc()
  mockExecute.mockReset()
  mockExecute.mockImplementation((command: { id?: string } | undefined) => {
    if (command?.id === 'route.path.create') {
      return {
        success: true,
        entityId: 'route-node-new',
        data: {
          nodeIds: ['route-node-new'],
          edgeIds: [],
          buildingId: 'BLD01',
          floorId: 'flr-0',
          hadNetwork: true,
          previousNetwork: undefined,
        },
      }
    }
    if (command?.id === 'entrance.access.assign') {
      return { success: true, entityId: 'entrance-1', data: { previousEntranceAccess: undefined } }
    }
    return { success: true, entityId: 'route-node-new' }
  })
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Route target finish', () => {
  it('opens the confirmation prompt when a click lands on a route segment', async () => {
    const probe = createProbe()
    const view = renderRouteTool(probe)

    act(() => { probe.click(11.8190, 122.0915) }) // free first point
    await waitFor(() => expect(mockExecute).not.toHaveBeenCalled())

    probe.setHits([{ layer: { id: 'floor-route-edges-line' }, properties: { id: 'e1' } }])
    act(() => { probe.click(11.8195, 122.0922) }) // click on the segment

    await waitFor(() => expect(view.result.current.routeConnectionPrompt?.edgeId).toBe('e1'))
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('Yes commits the path through a junction descriptor', async () => {
    const probe = createProbe()
    const view = renderRouteTool(probe)

    act(() => { probe.click(11.8190, 122.0915) })
    probe.setHits([{ layer: { id: 'floor-route-edges-line' }, properties: { id: 'e1' } }])
    act(() => { probe.click(11.8195, 122.0922) })
    await waitFor(() => expect(view.result.current.routeConnectionPrompt).not.toBeNull())

    act(() => { view.result.current.acceptRouteConnection() })

    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ id: 'route.path.create' })))
    const payload = mockExecute.mock.calls.at(-1)![0].payload as { points: Array<Record<string, unknown>> }
    expect(payload.points.at(-1)!.junction).toMatchObject({ edgeId: 'e1' })
    expect(view.result.current.routeConnectionPrompt).toBeNull()
  })

  it('surfaces a rejected junction commit and keeps the prompt instead of clearing it silently', async () => {
    mockExecute.mockImplementation((command: { id?: string } | undefined) => {
      if (command?.id === 'route.path.create') {
        return { success: false, error: 'Route edge e1 is a door connector and cannot be a junction target' }
      }
      return { success: true }
    })
    const onRouteStartRejected = vi.fn()
    const probe = createProbe()
    const view = renderHook(() => useFloorDrawing({
      map: probe.map, buildingId: 'BLD01', campusId: 'C1', floor: 0, tool: 'hallway', mapReady: true,
      onRouteStartRejected,
    }))

    act(() => { probe.click(11.8190, 122.0915) })
    probe.setHits([{ layer: { id: 'floor-route-edges-line' }, properties: { id: 'e1' } }])
    act(() => { probe.click(11.8195, 122.0922) })
    await waitFor(() => expect(view.result.current.routeConnectionPrompt?.edgeId).toBe('e1'))

    act(() => { view.result.current.acceptRouteConnection() })

    await waitFor(() => expect(onRouteStartRejected).toHaveBeenCalledWith(
      'Route edge e1 is a door connector and cannot be a junction target',
    ))
    expect(view.result.current.routeConnectionPrompt).not.toBeNull()
  })

  it('No commits the path at the clicked point without any junction', async () => {
    const probe = createProbe()
    const view = renderRouteTool(probe)

    act(() => { probe.click(11.8190, 122.0915) })
    probe.setHits([{ layer: { id: 'floor-route-edges-line' }, properties: { id: 'e1' } }])
    act(() => { probe.click(11.8195, 122.0922) })
    await waitFor(() => expect(view.result.current.routeConnectionPrompt).not.toBeNull())

    act(() => { view.result.current.declineRouteConnection() })

    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ id: 'route.path.create' })))
    const payload = mockExecute.mock.calls.at(-1)![0].payload as { points: Array<Record<string, unknown>> }
    expect(payload.points.at(-1)!.junction).toBeUndefined()
    expect(payload.points.at(-1)!.existingNodeId).toBeUndefined()
  })

  it('clicking a route node finishes the path bound to that exact node', async () => {
    const probe = createProbe()
    renderRouteTool(probe)

    act(() => { probe.click(11.8190, 122.0915) })
    probe.setHits([{
      layer: { id: 'floor-route-nodes-circle' },
      properties: { id: 'n2' },
      geometry: { type: 'Point', coordinates: [ORIGIN.lng + 10 / (DEG * Math.cos((ORIGIN.lat * Math.PI) / 180)), ORIGIN.lat] },
    }])
    act(() => { probe.click(11.8195, 122.0923) })

    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ id: 'route.path.create' })))
    const payload = mockExecute.mock.calls.at(-1)![0].payload as { points: Array<Record<string, unknown>> }
    expect(payload.points.at(-1)).toMatchObject({ existingNodeId: 'n2' })
  })

  it('finishing the route clears an open segment prompt instead of leaving it stale', async () => {
    const probe = createProbe()
    const view = renderRouteTool(probe)

    act(() => { probe.click(11.8190, 122.0915) }) // free first point
    await waitFor(() => expect(view.result.current.pendingPolygon).toHaveLength(1))

    act(() => { probe.click(11.8189, 122.0914) }) // free second point, distinct position
    await waitFor(() => expect(view.result.current.pendingPolygon).toHaveLength(2))

    probe.setHits([{ layer: { id: 'floor-route-edges-line' }, properties: { id: 'e1' } }])
    act(() => { probe.click(11.8195, 122.0922) }) // on the segment

    await waitFor(() => expect(view.result.current.routeConnectionPrompt?.edgeId).toBe('e1'))

    // Finish Route with the two pending points — the open prompt must be consumed.
    act(() => { view.result.current.confirm() })

    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ id: 'route.path.create' })))
    expect(view.result.current.routeConnectionPrompt).toBeNull()

    const routeCreatesAfterCommit = mockExecute.mock.calls
      .filter(([command]) => (command as { id?: string } | undefined)?.id === 'route.path.create')
      .length

    act(() => { view.result.current.acceptRouteConnection() })

    const routeCreatesAfterAccept = mockExecute.mock.calls
      .filter(([command]) => (command as { id?: string } | undefined)?.id === 'route.path.create')
      .length
    expect(routeCreatesAfterAccept).toBe(routeCreatesAfterCommit)
  })

  it('finishes at an Entrance with an existing outdoor target and assigns access', async () => {
    mockDocument.buildings[0].floors[0].entranceAccess = [{
      entranceId: 'entrance-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'old-node',
    }]
    const onEntranceAccessRequired = vi.fn()
    const probe = createProbe()
    renderHook(() => useFloorDrawing({
      map: probe.map, buildingId: 'BLD01', campusId: 'C1', floor: 0, tool: 'hallway', mapReady: true,
      onEntranceAccessRequired,
    }))

    act(() => { probe.click(11.8190, 122.0915) })
    probe.setHits([{
      layer: { id: 'floor-items-entrance' },
      properties: { id: 'entrance-1' },
      geometry: { type: 'Point', coordinates: [122.0910, 11.8195] },
    }])
    act(() => { probe.click(11.8195, 122.0910) })

    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ id: 'entrance.access.assign' })))
    expect(onEntranceAccessRequired).not.toHaveBeenCalled()
    const assign = mockExecute.mock.calls.find(call => call[0].id === 'entrance.access.assign')![0]
    expect(assign.payload).toMatchObject({ entranceId: 'entrance-1', outdoorNodeId: 'outdoor-1' })
  })

  it('hands off to the outdoor picker when the Entrance has no outdoor target', async () => {
    const onEntranceAccessRequired = vi.fn()
    const probe = createProbe()
    renderHook(() => useFloorDrawing({
      map: probe.map, buildingId: 'BLD01', campusId: 'C1', floor: 0, tool: 'hallway', mapReady: true,
      onEntranceAccessRequired,
    }))

    act(() => { probe.click(11.8190, 122.0915) })
    probe.setHits([{
      layer: { id: 'floor-items-entrance' },
      properties: { id: 'entrance-1' },
      geometry: { type: 'Point', coordinates: [122.0910, 11.8195] },
    }])
    act(() => { probe.click(11.8195, 122.0910) })

    await waitFor(() => expect(onEntranceAccessRequired).toHaveBeenCalled())
    expect(mockExecute.mock.calls.some(call => call[0].id === 'entrance.access.assign')).toBe(false)
    const request = onEntranceAccessRequired.mock.calls.at(-1)![0]
    expect(request).toMatchObject({ entranceId: 'entrance-1', buildingId: 'BLD01', floorId: 'flr-0' })
    expect(request.indoorRouteNodeId).toBeTruthy()
    expect(request.restore).toMatchObject({ buildingId: 'BLD01', floorId: 'flr-0', hadNetwork: true })
  })

  it('hands off with the pending anchor access snapshot so a cancelled finish can restore it', async () => {
    const onEntranceAccessRequired = vi.fn()
    const probe = createProbe()
    const view = renderHook(() => useFloorDrawing({
      map: probe.map, buildingId: 'BLD01', campusId: 'C1', floor: 0, tool: 'hallway', mapReady: true,
      pendingRouteAnchor: {
        entranceId: 'entrance-anchor',
        outdoorNodeId: 'outdoor-anchor',
        position: { lat: 11.8195, lng: 122.0935 },
      },
      onEntranceAccessRequired,
    }))

    await waitFor(() => expect(view.result.current.pendingPolygon).toHaveLength(1))
    probe.setHits([{
      layer: { id: 'floor-items-entrance' },
      properties: { id: 'entrance-1' },
      geometry: { type: 'Point', coordinates: [122.0910, 11.8195] },
    }])
    act(() => { probe.click(11.8195, 122.0910) })

    await waitFor(() => expect(onEntranceAccessRequired).toHaveBeenCalled())
    const anchorAssign = mockExecute.mock.calls.find(
      call => call[0].id === 'entrance.access.assign' && call[0].payload.entranceId === 'entrance-anchor',
    )
    expect(anchorAssign).toBeTruthy()
    const request = onEntranceAccessRequired.mock.calls.at(-1)![0]
    expect(request.restore.anchorAccessRestore).toBeDefined()
    expect(request.restore.anchorAccessRestore.entranceId).toBe('entrance-anchor')
    expect(Object.prototype.hasOwnProperty.call(request.restore.anchorAccessRestore, 'previousEntranceAccess')).toBe(true)
    expect(request.restore.anchorAccessRestore.previousEntranceAccess).toBeUndefined()
  })

  it('restores the pending anchor access when the direct target assign fails', async () => {
    mockDocument.buildings[0].floors[0].entranceAccess = [{
      entranceId: 'entrance-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'old-node',
    }]
    const previousAnchorAccess = [{
      entranceId: 'entrance-anchor',
      outdoorNodeId: 'outdoor-previous',
      indoorRouteNodeId: 'previous-node',
    }]
    mockExecute.mockImplementation((command: { id?: string; payload?: Record<string, any> } | undefined) => {
      if (command?.id === 'route.path.create') {
        return {
          success: true,
          entityId: 'route-node-new',
          data: {
            nodeIds: ['route-node-new'],
            edgeIds: [],
            buildingId: 'BLD01',
            floorId: 'flr-0',
            hadNetwork: true,
            previousNetwork: undefined,
          },
        }
      }
      if (command?.id === 'entrance.access.assign' && command.payload?.entranceId === 'entrance-anchor') {
        return { success: true, entityId: 'entrance-anchor', data: { previousEntranceAccess: previousAnchorAccess } }
      }
      if (command?.id === 'entrance.access.assign') {
        return { success: false, error: 'Target Entrance is invalid' }
      }
      return { success: true }
    })

    const onEntranceAccessRequired = vi.fn()
    const onRouteStartRejected = vi.fn()
    const probe = createProbe()
    const view = renderHook(() => useFloorDrawing({
      map: probe.map, buildingId: 'BLD01', campusId: 'C1', floor: 0, tool: 'hallway', mapReady: true,
      pendingRouteAnchor: {
        entranceId: 'entrance-anchor',
        outdoorNodeId: 'outdoor-anchor',
        position: { lat: 11.8195, lng: 122.0935 },
      },
      onEntranceAccessRequired,
      onRouteStartRejected,
    }))

    await waitFor(() => expect(view.result.current.pendingPolygon).toHaveLength(1))
    probe.setHits([{
      layer: { id: 'floor-items-entrance' },
      properties: { id: 'entrance-1' },
      geometry: { type: 'Point', coordinates: [122.0910, 11.8195] },
    }])
    act(() => { probe.click(11.8195, 122.0910) })

    await waitFor(() => {
      expect(mockExecute.mock.calls.some(call => call[0].id === 'entrance.access.unassign')).toBe(true)
    })
    expect(onEntranceAccessRequired).not.toHaveBeenCalled()
    expect(onRouteStartRejected).toHaveBeenCalled()
    const unassign = mockExecute.mock.calls.find(call => call[0].id === 'entrance.access.unassign')![0]
    expect(unassign.payload).toEqual({
      buildingId: 'BLD01',
      floorId: 'flr-0',
      entranceId: 'entrance-anchor',
      restoreEntranceAccess: previousAnchorAccess,
    })
    const routeRestores = mockExecute.mock.calls.filter(
      call => call[0].id === 'route.path.create' && call[0].payload?.restore === true,
    )
    expect(routeRestores).toHaveLength(1)
  })
})
