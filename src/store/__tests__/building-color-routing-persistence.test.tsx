import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { EditorBridge } from '@/components/studio/EditorBridge'
import type { CampusDocument, Road, RoadJunction } from '@navi/core'
import { GraphAdapter, type EditorContext } from '@navi/editor'
import { createDocument } from '../../../packages/editor/src/context/create-editor-context'
import { Graph } from '@/engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'
import { validateRouteNetwork } from '../../../packages/editor/src/validation/rules/modules/route-network'

const MAP_ID = 'building-color-routing-persistence'
const ROUTE_NODE_COUNT = 197
const ROUTE_EDGE_COUNT = 218

interface SavePayload extends Record<string, unknown> {
  forceServerOverwrite?: boolean
  buildings?: Array<{ id: string; color?: string; name?: string }>
  nodes?: Array<{ id: string }>
  edges?: Array<{ id: string; from: string; to: string }>
}

function makeLegacyGraph(): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({
    id: 'building-a',
    name: 'Color Me',
    campusId: MAP_ID,
    footprint: [
      { lat: 14.599, lng: 120.999 },
      { lat: 14.601, lng: 120.999 },
      { lat: 14.601, lng: 121.001 },
      { lat: 14.599, lng: 121.001 },
    ],
    floors: [0],
    floorData: [{ id: 'floor-a-0', level: 0 }],
    baseElevation: 0,
    height: 12,
    color: '#336699',
  } as never)
  graph.addBuilding({
    id: 'building-b',
    name: 'Second Building',
    campusId: MAP_ID,
    footprint: [],
    floors: [],
    floorData: [],
    baseElevation: 0,
    height: 12,
  } as never)

  const localPositions = Array.from({ length: ROUTE_NODE_COUNT }, (_, index) => {
    const angle = (index / ROUTE_NODE_COUNT) * Math.PI * 2
    return { x: Math.cos(angle) * 50, y: Math.sin(angle) * 50 }
  })
  const origin = { lat: 14.6, lng: 121 }
  const metersPerDegree = 111320
  graph.setNodes(localPositions.map((position, index) => ({
    id: `N-route-route-node-${index}`,
    label: 'Route waypoint',
    type: 'intersection',
    position: {
      lat: origin.lat + position.y / metersPerDegree,
      lng: origin.lng + position.x / (metersPerDegree * Math.cos((origin.lat * Math.PI) / 180)),
    },
    floor: 0,
    buildingId: 'building-a',
    campusId: MAP_ID,
    metadata: { routeNodeId: `route-node-${index}`, routeNodeType: 'waypoint' },
  })))

  const edgePairs: Array<[number, number]> = Array.from({ length: ROUTE_NODE_COUNT }, (_, index) => [
    index,
    (index + 1) % ROUTE_NODE_COUNT,
  ])
  for (let index = 0; edgePairs.length < ROUTE_EDGE_COUNT; index += 1) {
    edgePairs.push([index, (index + 47) % ROUTE_NODE_COUNT])
  }
  graph.setEdges(edgePairs.map(([fromIndex, toIndex], index) => {
    const from = localPositions[fromIndex]
    const to = localPositions[toIndex]
    return {
      id: `E-route-route-edge-${index}`,
      from: `N-route-route-node-${fromIndex}`,
      to: `N-route-route-node-${toIndex}`,
      distance: Math.hypot(to.x - from.x, to.y - from.y),
      type: 'walkway',
      campusId: MAP_ID,
    }
  }))

  return graph
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function routeNetworkFrom(document: NonNullable<ReturnType<typeof useGraphStore.getState>['authoredDocument']>) {
  return document.buildings.find((building) => building.id === 'building-a')!.floors[0].routeNetwork!
}

function makeProductionRoadDocument(): CampusDocument {
  const roads: Road[] = []
  const roadJunctions: RoadJunction[] = []
  const gridLongitudes = [0, 0.01, 0.02, 0.03, 0.04]
  const gridLatitudes = [0, 0.01, 0.02, 0.03]

  const nonGridPoints = (start: { lat: number; lng: number }, end: { lat: number; lng: number }, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const fraction = index / (count - 1)
      return {
        lat: start.lat + (end.lat - start.lat) * fraction,
        lng: start.lng + (end.lng - start.lng) * fraction,
      }
    })

  const addRoad = (id: string, points: Road['polyline']['points']) => {
    roads.push({
      id,
      name: id,
      polyline: { points },
      width: 5,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    })
  }

  const horizontalIds = gridLatitudes.map((_, row) => `synthetic-horizontal-${row}`)
  const verticalIds = gridLongitudes.map((_, column) => `synthetic-vertical-${column}`)
  const offGridPoint = (index: number, count: number, start: number, span: number) => {
    if (index === 0) return start
    if (index === count - 1) return start + span
    const alternatingOffset = index % 2 === 0 ? -0.0003 : 0.0003
    return start + (span * index) / (count - 1) + alternatingOffset
  }

  gridLatitudes.forEach((latitude, row) => {
    const points = Array.from({ length: 11 }, (_, index) => ({
      lat: latitude,
      lng: offGridPoint(index, 11, -0.006, 0.052),
    }))
    const vertexIndex = [2, 4, 6][row]
    if (vertexIndex !== undefined) {
      points[vertexIndex] = { lat: latitude, lng: gridLongitudes[row] }
    }
    addRoad(horizontalIds[row], points)
  })
  gridLongitudes.forEach((longitude, column) => {
    const points = Array.from({ length: 11 }, (_, index) => ({
      lat: offGridPoint(index, 11, -0.006, 0.042),
      lng: longitude,
    }))
    addRoad(verticalIds[column], points)
  })

  gridLatitudes.forEach((latitude, row) => {
    gridLongitudes.forEach((longitude, column) => {
      roadJunctions.push({
        id: `synthetic-grid-junction-${row}-${column}`,
        position: { lat: latitude, lng: longitude },
        roadIds: [horizontalIds[row], verticalIds[column]],
        source: 'authored',
      })
    })
  })

  const sharedEndpoint = { lat: 0.1, lng: 0.1 }
  const branchRoadIds = ['synthetic-branch-a', 'synthetic-branch-b', 'synthetic-branch-c']
  const branchEnds = [
    { lat: 0.11, lng: 0.12 },
    { lat: 0.11, lng: 0.08 },
    { lat: 0.09, lng: 0.1 },
  ]
  branchRoadIds.forEach((id, index) => addRoad(id, nonGridPoints(sharedEndpoint, branchEnds[index], 10)))
  roadJunctions.push({
    id: 'synthetic-three-road-junction',
    position: sharedEndpoint,
    roadIds: branchRoadIds,
    source: 'authored',
  })

  for (let index = 0; index < 7; index += 1) {
    const count = index < 5 ? 10 : 9
    const latitude = 0.2 + index * 0.01
    addRoad(
      `synthetic-isolated-road-${index}`,
      nonGridPoints({ lat: latitude, lng: 0.2 }, { lat: latitude, lng: 0.24 }, count),
    )
  }

  const building: CampusDocument['buildings'][number] = {
    id: 'building-a',
    name: 'Color Me',
    code: 'CM',
    category: 'academic',
    description: '',
    footprint: { points: [] },
    baseElevation: 0,
    height: 12,
    floors: Array.from({ length: 28 }, (_, level) => ({
      id: `synthetic-floor-${level}`,
      level,
      label: `Floor ${level}`,
      elevation: level * 3,
      height: 3,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
      entrances: [],
      connectorStops: [],
      parametricComponents: [],
      metadata: {},
    })),
    verticalConnectors: [],
    color: '#336699',
    aliases: [],
    metadata: {},
  }

  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: MAP_ID,
      name: 'Production-shaped road projection fixture',
      description: '',
      lastModified: '',
      editorVersion: 'test',
    },
    buildings: [building],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions,
  }
}

function removeRedundantEdges(graph: Graph, targetCount: number): number {
  let retainedEdges = graph.edges
  let removedCount = 0

  for (const candidate of [...retainedEdges]) {
    if (retainedEdges.length <= targetCount) break

    const visited = new Set([candidate.from])
    const queue = [candidate.from]
    while (queue.length > 0 && !visited.has(candidate.to)) {
      const current = queue.shift()!
      for (const edge of retainedEdges) {
        if (edge.id === candidate.id) continue
        const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null
        if (next && !visited.has(next)) {
          visited.add(next)
          queue.push(next)
        }
      }
    }

    if (visited.has(candidate.to)) {
      retainedEdges = retainedEdges.filter((edge) => edge.id !== candidate.id)
      removedCount += 1
    }
  }

  graph.setEdges(retainedEdges)
  return removedCount
}

describe('legacy route graph survives ordinary building edits and normal save', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({
      graph: new Graph(),
      currentMapId: null,
      authoredDocument: null,
      pendingAuthoredMutations: [],
      syncStatus: 'idle',
      syncError: null,
      campusReady: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('migrates 197 legacy route nodes/218 edges before color save, keeps later edits and reload stable', async () => {
    let serverSnapshot: Record<string, unknown> = {}
    let revision = 0
    const posted: SavePayload[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as SavePayload
        posted.push(body)
        serverSnapshot = structuredClone(body)
        revision += 1
        return jsonResponse({ success: true, updatedAt: `R${revision}` })
      }
      return jsonResponse({ ...structuredClone(serverSnapshot), updatedAt: `R${revision}` })
    })
    vi.stubGlobal('fetch', fetchMock)

    const graph = makeLegacyGraph()
    useGraphStore.setState({ graph, currentMapId: MAP_ID })
    await useGraphStore.getState().save()
    expect(posted).toHaveLength(1)
    expect(graph.nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(graph.edges).toHaveLength(ROUTE_EDGE_COUNT)

    const guardWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<EditorBridge><div /></EditorBridge>)
    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    const dispatcher = context.services.get('dispatcher') as {
      status: string
      execute: (command: { id: string; label: string; payload: Record<string, unknown> }) => { success: boolean; error?: string }
    }
    const workflowStore = context.services.get('workflowStore') as {
      getSnapshot: () => { saveState: string }
    }
    await waitFor(() => expect(dispatcher.status).toBe('ready'))
    await waitFor(() => expect(workflowStore.getSnapshot().saveState).toBe('saved'))

    const originalNodeIds = graph.nodes.map((node) => node.id).sort()
    const originalEdgeIds = graph.edges.map((edge) => edge.id).sort()
    expect(graph.nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(graph.edges).toHaveLength(ROUTE_EDGE_COUNT)
    vi.useFakeTimers()

    act(() => {
      expect(dispatcher.execute({
        id: 'entity.update',
        label: 'Change Building Color',
        payload: { entityId: 'building-a', changes: { color: '#EF4444' } },
      }).success).toBe(true)
    })

    const afterColorEdit = useGraphStore.getState().graph
    expect(afterColorEdit.nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(afterColorEdit.edges).toHaveLength(ROUTE_EDGE_COUNT)
    expect(afterColorEdit.nodes.map((node) => node.id).sort()).toEqual(originalNodeIds)
    expect(afterColorEdit.edges.map((edge) => edge.id).sort()).toEqual(originalEdgeIds)
    expect(afterColorEdit.edges.every((edge) => afterColorEdit.getNode(edge.from) && afterColorEdit.getNode(edge.to))).toBe(true)
    expect(validateRouteNetwork(context.document, 'publish')).toEqual([])

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(posted).toHaveLength(2)
    expect(posted[1].forceServerOverwrite).toBe(false)
    expect(posted[1].buildings.find((building: { id: string }) => building.id === 'building-a')?.color).toBe('#EF4444')
    expect(posted[1].nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(posted[1].edges).toHaveLength(ROUTE_EDGE_COUNT)
    expect(posted[1].nodes?.map((node) => node.id).sort()).toEqual(originalNodeIds)
    expect(posted[1].edges?.map((edge) => edge.id).sort()).toEqual(originalEdgeIds)
    const savedNodeIds = new Set(posted[1].nodes?.map((node) => node.id))
    expect(posted[1].edges?.every((edge) => savedNodeIds.has(edge.from) && savedNodeIds.has(edge.to))).toBe(true)
    expect(guardWarning.mock.calls.some(([message]) => String(message).includes('save blocked by safety guard'))).toBe(false)

    act(() => {
      expect(dispatcher.execute({
        id: 'entity.update',
        label: 'Edit Another Building',
        payload: { entityId: 'building-b', changes: { name: 'Second Building Edited' } },
      }).success).toBe(true)
    })
    expect(useGraphStore.getState().graph.nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(useGraphStore.getState().graph.edges).toHaveLength(ROUTE_EDGE_COUNT)
    expect(useGraphStore.getState().graph.nodes.map((node) => node.id).sort()).toEqual(originalNodeIds)
    expect(useGraphStore.getState().graph.edges.map((edge) => edge.id).sort()).toEqual(originalEdgeIds)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(posted).toHaveLength(3)
    expect(posted[2].buildings.find((building: { id: string }) => building.id === 'building-b')?.name).toBe('Second Building Edited')

    const routeNode = routeNetworkFrom(context.document).nodes[0]
    const oldPosition = { ...routeNode.position }
    const oldGraphPosition = { ...graph.getNode(`N-route-${routeNode.id}`)!.position }
    const oldIncidentDistance = routeNetworkFrom(context.document).edges.find((edge) => edge.from === routeNode.id || edge.to === routeNode.id)!.distance
    act(() => {
      expect(dispatcher.execute({
        id: 'route.node.update',
        label: 'Move Route Node',
        payload: { nodeId: routeNode.id, patch: { position: { x: oldPosition.x + 5, y: oldPosition.y + 2 } } },
      }).success).toBe(true)
    })
    const afterRouteEdit = useGraphStore.getState().graph
    expect(afterRouteEdit.nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(afterRouteEdit.edges).toHaveLength(ROUTE_EDGE_COUNT)
    expect(afterRouteEdit.nodes.map((node) => node.id).sort()).toEqual(originalNodeIds)
    expect(afterRouteEdit.edges.map((edge) => edge.id).sort()).toEqual(originalEdgeIds)
    expect(afterRouteEdit.getNode(`N-route-${routeNode.id}`)?.position).not.toEqual(
      oldGraphPosition,
    )
    expect(routeNetworkFrom(context.document).edges.find((edge) => edge.from === routeNode.id || edge.to === routeNode.id)!.distance).not.toBe(oldIncidentDistance)
    expect(validateRouteNetwork(context.document, 'publish')).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(posted).toHaveLength(4)
    expect(posted[3].forceServerOverwrite).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(posted).toHaveLength(4)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(workflowStore.getSnapshot().saveState).toBe('saved')
    expect(guardWarning.mock.calls.some(([message]) => String(message).includes('save blocked by safety guard'))).toBe(false)

    cleanup()
    vi.useRealTimers()
    useGraphStore.setState({
      graph: new Graph(),
      currentMapId: null,
      authoredDocument: null,
      pendingAuthoredMutations: [],
      syncStatus: 'idle',
      syncError: null,
      campusReady: false,
    })
    act(() => useGraphStore.getState().loadMapData(MAP_ID))
    await waitFor(() => expect(useGraphStore.getState().syncStatus).toBe('synced'))
    const reloaded = useGraphStore.getState()
    expect(reloaded.graph.nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(reloaded.graph.edges).toHaveLength(ROUTE_EDGE_COUNT)
    expect(reloaded.authoredDocument?.buildings.find((building) => building.id === 'building-a')?.color).toBe('#EF4444')
    expect(reloaded.authoredDocument?.buildings.find((building) => building.id === 'building-b')?.name).toBe('Second Building Edited')
    expect(routeNetworkFrom(reloaded.authoredDocument!).nodes).toHaveLength(ROUTE_NODE_COUNT)
    expect(routeNetworkFrom(reloaded.authoredDocument!).edges).toHaveLength(ROUTE_EDGE_COUNT)
    expect(routeNetworkFrom(reloaded.authoredDocument!).nodes.some((node) => node.id === routeNode.id && node.position.x === oldPosition.x + 5)).toBe(true)
    expect(validateRouteNetwork(reloaded.authoredDocument!, 'publish')).toEqual([])
  }, 30000)

  it('keeps production-shaped trace-road IDs stable through a building color edit', async () => {
    const document = makeProductionRoadDocument()
    const graph = new Graph()
    graph.campusId = MAP_ID
    new GraphAdapter(graph).sync(document)
    expect(removeRedundantEdges(graph, 218)).toBe(3)

    expect(document.roads).toHaveLength(19)
    expect(document.roads.reduce((total, road) => total + road.polyline.points.length, 0)).toBe(197)
    expect(document.roadJunctions).toHaveLength(21)
    expect(graph.traces).toHaveLength(19)
    expect(graph.nodes).toHaveLength(218)
    expect(graph.nodes.filter((node) => typeof node.metadata?.traceId === 'string')).toHaveLength(197)
    expect(graph.nodes.filter((node) => node.metadata?.connectionNode === true)).toHaveLength(21)
    expect(graph.edges).toHaveLength(218)
    expect(graph.edges.every((edge) => graph.getNode(edge.from) && graph.getNode(edge.to))).toBe(true)
    expect(graph.nodes.every((node) => node.buildingId === '' && node.floor === 0)).toBe(true)
    expect(graph.nodes.some((node) => node.metadata?.routeNodeId || node.metadata?.routeNodeType)).toBe(false)
    expect(graph.edges.some((edge) => edge.id.startsWith('E-route-'))).toBe(false)
    expect(graph.edges.every((edge) => !('buildingId' in edge) && !('floor' in edge))).toBe(true)
    expect(document.buildings.flatMap((building) => building.floors)
      .every((floor) => !Object.prototype.hasOwnProperty.call(floor, 'routeNetwork'))).toBe(true)

    const legacyDocument = createDocument(graph)
    expect(legacyDocument.buildings.flatMap((building) => building.floors)
      .every((floor) => !Object.prototype.hasOwnProperty.call(floor, 'routeNetwork'))).toBe(true)

    const originalNodeIds = graph.nodes.map((node) => node.id).sort()
    const originalEdgeIds = graph.edges.map((edge) => edge.id).sort()
    useGraphStore.setState({
      graph,
      currentMapId: MAP_ID,
      authoredDocument: structuredClone(document),
      syncStatus: 'idle',
      syncError: null,
      campusReady: true,
    })

    let serverSnapshot: Record<string, unknown> = {}
    let revision = 0
    const posted: SavePayload[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as SavePayload
        posted.push(body)
        serverSnapshot = structuredClone(body)
        revision += 1
        return jsonResponse({ success: true, updatedAt: `TRACE-R${revision}` })
      }
      return jsonResponse({ ...structuredClone(serverSnapshot), updatedAt: `TRACE-R${revision}` })
    })
    vi.stubGlobal('fetch', fetchMock)
    await useGraphStore.getState().save()
    expect(posted).toHaveLength(1)

    const guardWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<EditorBridge><div /></EditorBridge>)
    const context = (window as unknown as { __naviContext: EditorContext }).__naviContext
    expect(context.document.buildings.flatMap((building) => building.floors)
      .every((floor) => !Object.prototype.hasOwnProperty.call(floor, 'routeNetwork'))).toBe(true)
    const dispatcher = context.services.get('dispatcher') as {
      status: string
      execute: (command: { id: string; label: string; payload: Record<string, unknown> }) => { success: boolean; error?: string }
    }
    const workflowStore = context.services.get('workflowStore') as {
      getSnapshot: () => { saveState: string }
    }
    await waitFor(() => expect(dispatcher.status).toBe('ready'))
    await waitFor(() => expect(workflowStore.getSnapshot().saveState).toBe('saved'))
    expect(useGraphStore.getState().graph.nodes.map((node) => node.id).sort()).toEqual(originalNodeIds)
    expect(useGraphStore.getState().graph.edges.map((edge) => edge.id).sort()).toEqual(originalEdgeIds)
    vi.useFakeTimers()

    act(() => {
      expect(dispatcher.execute({
        id: 'entity.update',
        label: 'Change Building Color',
        payload: { entityId: 'building-a', changes: { color: '#EF4444' } },
      }).success).toBe(true)
    })
    expect(useGraphStore.getState().graph.nodes.map((node) => node.id).sort()).toEqual(originalNodeIds)
    const graphAfterEdit = useGraphStore.getState().graph
    expect(graphAfterEdit.edges).toHaveLength(221)
    expect(graphAfterEdit.edges.filter((edge) => originalEdgeIds.includes(edge.id))).toHaveLength(218)
    expect(graphAfterEdit.edges.every((edge) => graphAfterEdit.getNode(edge.from) && graphAfterEdit.getNode(edge.to))).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    const blockedWarnings = guardWarning.mock.calls.filter(([message]) =>
      String(message).includes('save blocked by safety guard'),
    )
    const blockedRemovalCount = blockedWarnings.reduce((count, [, details]) => {
      const diagnostic = details as { removedEntityCount?: number } | undefined
      return count + (diagnostic?.removedEntityCount ?? 0)
    }, 0)

    expect(blockedRemovalCount).toBe(0)
    expect(posted).toHaveLength(2)
    expect(posted[1].nodes).toHaveLength(218)
    expect(posted[1].edges).toHaveLength(221)
    expect(posted[1].nodes?.map((node) => node.id).sort()).toEqual(originalNodeIds)
    expect(posted[1].edges?.filter((edge) => originalEdgeIds.includes(edge.id))).toHaveLength(218)
    expect(useGraphStore.getState().syncStatus).toBe('synced')

    const persistedDocument = structuredClone(context.document)
    const persistedNodeIds = posted[1].nodes?.map((node) => node.id).sort() ?? []
    const persistedEdgeIds = posted[1].edges?.map((edge) => edge.id).sort() ?? []
    const reloadOne = Graph.fromJSON(serverSnapshot as Parameters<typeof Graph.fromJSON>[0])
    reloadOne.campusId = MAP_ID
    new GraphAdapter(reloadOne, context.transformer).sync(persistedDocument)
    expect(reloadOne.nodes.map((node) => node.id).sort()).toEqual(persistedNodeIds)
    expect(reloadOne.edges.map((edge) => edge.id).sort()).toEqual(persistedEdgeIds)
    expect(reloadOne.traces).toHaveLength(19)
    expect(reloadOne.edges.every((edge) => reloadOne.getNode(edge.from) && reloadOne.getNode(edge.to))).toBe(true)

    const reloadTwo = Graph.fromJSON(reloadOne.toJSON())
    new GraphAdapter(reloadTwo, context.transformer).sync(persistedDocument)
    expect(reloadTwo.nodes.map((node) => node.id).sort()).toEqual(persistedNodeIds)
    expect(reloadTwo.edges.map((edge) => edge.id).sort()).toEqual(persistedEdgeIds)
    expect(reloadTwo.traces).toHaveLength(19)
    expect(reloadTwo.edges.every((edge) => reloadTwo.getNode(edge.from) && reloadTwo.getNode(edge.to))).toBe(true)
    expect(persistedDocument.roadJunctions).toHaveLength(21)
    expect(persistedDocument.buildings.flatMap((building) => building.floors)
      .every((floor) => !Object.prototype.hasOwnProperty.call(floor, 'routeNetwork'))).toBe(true)
  }, 30000)
})
