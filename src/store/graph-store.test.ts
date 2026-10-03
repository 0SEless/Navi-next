import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../engine/graph'
import type { CampusDocument } from '@navi/core'
import { __resetGraphSaveQueuesForTests, useGraphStore } from './graph-store'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('graph store persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({
      currentMapId: 'test-map',
      syncError: null,
      syncStatus: 'idle',
    })
  })

  it('does not resolve save until the graph API sync resolves', async () => {
    let resolveRequest: ((response: Response) => void) | undefined
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveRequest = resolve
        })
      }
      return Promise.resolve(
        jsonResponse({ buildings: [], nodes: [], edges: [], updatedAt: '2026-09-13T00:00:00.000Z' }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const saveResult = useGraphStore.getState().save()

    expect(saveResult).toBeInstanceOf(Promise)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/graph',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(useGraphStore.getState().syncStatus).toBe('syncing')

    let resolved = false
    void saveResult.then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    resolveRequest?.(jsonResponse({ success: true, updatedAt: '2026-09-13T00:00:00.000Z' }))
    await saveResult

    expect(resolved).toBe(true)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('rejects save when the graph API rejects and keeps the local recovery snapshot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'graph validation failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(useGraphStore.getState().save()).rejects.toThrow('graph validation failed')

    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(useGraphStore.getState().syncError).toBe('graph validation failed')
    expect(localStorage.getItem('navi-graph-test-map')).not.toBeNull()
  })

  it('requires server confirmation before restoring a saved state for a matching local snapshot', async () => {
    const mapId = 'cached-map'
    const graph = new Graph()
    graph.addBuilding({
      id: 'building-1',
      name: 'Main Hall',
      campusId: mapId,
      footprint: [],
    } as never)
    useGraphStore.setState({ graph, currentMapId: mapId })
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ success: true, updatedAt: '2026-09-13T00:00:00.000Z' })
      }
      return jsonResponse({ buildings: [], nodes: [], edges: [], updatedAt: '2026-09-13T00:00:00.000Z' })
    }))

    await useGraphStore.getState().save()
    expect(localStorage.getItem(`navi-sync-status-${mapId}`)).not.toBeNull()

    // The server now serves the exact cached snapshot, so the freshness check
    // can confirm it. Until that resolves, a matching marker only means
    // "checking" — never "synced".
    const cached = localStorage.getItem(`navi-graph-${mapId}`)
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ success: true, updatedAt: '2026-09-13T00:00:00.000Z' })
      }
      return jsonResponse(JSON.parse(cached ?? '{}'))
    }))
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(mapId)
    expect(useGraphStore.getState().syncStatus).toBe('checking')

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('synced')
    })

    // Content must match for the marker to be trusted. Tampering with the
    // cached content while the server remains at the acknowledged revision is
    // a safe local-ahead draft, not a true server divergence.
    const savedSnapshot = JSON.parse(cached ?? '{}')
    savedSnapshot.buildings[0].name = 'Tampered Hall'
    localStorage.setItem(`navi-graph-${mapId}`, JSON.stringify(savedSnapshot))
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(mapId)
    expect(useGraphStore.getState().syncStatus).toBe('idle')

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('idle')
    })
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Tampered Hall')
  })

  it('persists and reloads the authored companion without nesting or rewriting the Graph shape', async () => {
    const mapId = 'authored-local-map'
    const graph = new Graph(mapId)
    graph.addBuilding({ id: 'building-1', name: 'Main Hall', campusId: mapId, footprint: [] } as never)
    const authoredDocument: CampusDocument = {
      schemaVersion: 1,
      version: 3,
      metadata: {
        campusId: mapId,
        name: 'Authored Local Campus',
        description: 'Preserved locally',
        lastModified: '2026-09-21T00:00:00.000Z',
        editorVersion: 'test',
      },
      buildings: [],
      roads: [],
      panoramas: [{ id: 'panorama-1', label: 'Main', position: { x: 1, y: 2 }, heading: 90, imageAssetId: 'asset-1', hotspots: [] }],
      qrCheckpoints: [{ id: 'qr-1', label: 'QR', position: { x: 2, y: 3 }, code: 'navi://local', metadata: { authored: true } }],
    }
    useGraphStore.setState({ graph, currentMapId: mapId, authoredDocument })

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ success: true, updatedAt: '2026-09-21T00:00:01.000Z' })
      }
      return jsonResponse(JSON.parse(localStorage.getItem(`navi-graph-${mapId}`) ?? '{}'))
    })
    vi.stubGlobal('fetch', fetchMock)

    await useGraphStore.getState().save()
    const persisted = JSON.parse(localStorage.getItem(`navi-graph-${mapId}`) ?? '{}')
    expect(persisted.nodes).toEqual([])
    expect(persisted.authoredDocument.metadata.name).toBe('Authored Local Campus')
    expect(persisted.authoredDocument.panoramas[0].id).toBe('panorama-1')
    expect(persisted.authoredDocument.qrCheckpoints[0].id).toBe('qr-1')

    useGraphStore.setState({ graph: new Graph(), authoredDocument: null, currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(mapId)
    expect(useGraphStore.getState().authoredDocument?.metadata.name).toBe('Authored Local Campus')
    expect(useGraphStore.getState().authoredDocument?.panoramas).toHaveLength(1)
    expect(useGraphStore.getState().authoredDocument?.qrCheckpoints).toHaveLength(1)
  })

  it('keeps the authored companion in local-only draft persistence', () => {
    const mapId = 'authored-teardown-map'
    const authoredDocument: CampusDocument = {
      schemaVersion: 1,
      version: 4,
      metadata: {
        campusId: mapId,
        name: 'Teardown Campus',
        description: '',
        lastModified: '2026-09-21T00:00:00.000Z',
        editorVersion: 'test',
      },
      buildings: [],
      roads: [],
      panoramas: [],
      qrCheckpoints: [{ id: 'qr-teardown', label: 'QR', position: { x: 0, y: 0 }, code: 'navi://teardown' }],
    }
    useGraphStore.setState({ graph: new Graph(mapId), currentMapId: mapId, authoredDocument })

    useGraphStore.getState().persistLocalDraft()

    const persisted = JSON.parse(localStorage.getItem(`navi-graph-${mapId}`) ?? '{}')
    expect(persisted.authoredDocument.metadata.name).toBe('Teardown Campus')
    expect(persisted.authoredDocument.qrCheckpoints[0].id).toBe('qr-teardown')
  })

  it('logs a metadata-only safety guard diagnostic after a successful save acknowledgment', async () => {
    const mapId = 'PRIVATE_CAMPUS_IDENTIFIER'
    const buildingA = 'PRIVATE_BUILDING_A'
    const buildingB = 'PRIVATE_BUILDING_B'
    const graph = new Graph(mapId)
    graph.addBuilding({
      id: buildingA,
      name: 'PRIVATE_BUILDING_NAME_A',
      campusId: mapId,
      footprint: [],
    } as never)
    graph.addBuilding({
      id: buildingB,
      name: 'PRIVATE_BUILDING_NAME_B',
      campusId: mapId,
      footprint: [],
    } as never)
    graph.addNode({
      id: 'PRIVATE_NODE_IDENTIFIER',
      label: 'PRIVATE_NODE_NAME',
      name: 'PRIVATE_NODE_NAME',
      type: 'intersection',
      campusId: mapId,
      buildingId: buildingA,
      floor: 0,
      position: { lat: 121.123456, lng: -118.654321 },
    } as never)
    const authoredDocument: CampusDocument = {
      schemaVersion: 1,
      version: 7,
      metadata: {
        campusId: mapId,
        name: 'PRIVATE_DOCUMENT_NAME',
        description: 'PRIVATE_DOCUMENT_PAYLOAD private-token-sentinel fingerprint-deadbeef',
        lastModified: '2026-09-24T00:00:00.000Z',
        editorVersion: 'test',
      },
      buildings: [],
      roads: [],
      panoramas: [],
      qrCheckpoints: [],
    }
    useGraphStore.setState({ graph, authoredDocument, currentMapId: mapId, campusReady: true })
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, updatedAt: 'ACK-R1' }))
    vi.stubGlobal('fetch', fetchMock)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useGraphStore.getState().save()
    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    useGraphStore.getState().recordAuthoredMutation('building', buildingA, null)
    graph.setBuildings(graph.buildings.filter((building) => building.id !== buildingB))
    useGraphStore.setState({ authoredDocument: { ...authoredDocument, version: 8 } })
    await useGraphStore.getState().save()

    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const guardWarning = warning.mock.calls.find(([message]) => message === '[graph-store] save blocked by safety guard')
    expect(guardWarning).toEqual([
      '[graph-store] save blocked by safety guard',
      {
        reason: 'removed-entity-outside-pending-scope',
        operation: 'performSyncToSupabase',
        phase: 'pre-network-save-guard',
        removedEntityCount: 1,
        removedEntityKinds: { buildings: 1, components: 0, nodes: 0, edges: 0, traces: 0, doors: 0 },
        coveredRemovalCount: 0,
        coveredEntityKinds: { buildings: 0, components: 0, nodes: 0, edges: 0, traces: 0, doors: 0 },
        uncoveredRemovalCount: 1,
        uncoveredEntityKinds: { buildings: 1, components: 0, nodes: 0, edges: 0, traces: 0, doors: 0 },
        removedFromAcknowledgedBaselineCount: 1,
        pendingScopeCount: 1,
        pendingScopeKinds: { building: 1, floor: 0, door: 0, route: 0, poi: 0, outdoor: 0 },
        allRemovalsCovered: false,
        acknowledgedBaselinePresent: true,
        pendingIntentPresent: true,
        documentChangedAfterPreviousAck: true,
        previousSaveSucceeded: true,
      },
    ])

    const diagnosticJson = JSON.stringify(guardWarning?.[1])
    for (const forbiddenValue of [
      mapId,
      buildingA,
      buildingB,
      'PRIVATE_BUILDING_NAME_A',
      'PRIVATE_BUILDING_NAME_B',
      'PRIVATE_NODE_IDENTIFIER',
      'PRIVATE_NODE_NAME',
      'PRIVATE_DOCUMENT_NAME',
      'PRIVATE_DOCUMENT_PAYLOAD',
      'private-token-sentinel',
      'fingerprint-deadbeef',
      '121.123456',
      '-118.654321',
    ]) {
      expect(diagnosticJson).not.toContain(forbiddenValue)
    }
  })

  it('does not claim a previous save or document-version change after a read-only baseline load', async () => {
    const mapId = 'PRIVATE_CAMPUS_IDENTIFIER'
    const buildingA = 'PRIVATE_BUILDING_A'
    const buildingB = 'PRIVATE_BUILDING_B'
    const serverGraph = new Graph(mapId)
    serverGraph.addBuilding({ id: buildingA, name: 'PRIVATE_BUILDING_NAME_A', campusId: mapId, footprint: [] } as never)
    serverGraph.addBuilding({ id: buildingB, name: 'PRIVATE_BUILDING_NAME_B', campusId: mapId, footprint: [] } as never)
    useGraphStore.setState({ graph: new Graph(mapId), currentMapId: mapId, authoredDocument: null })
    const fetchMock = vi.fn(async () => jsonResponse({ ...serverGraph.toJSON(), updatedAt: 'READ-R1' }))
    vi.stubGlobal('fetch', fetchMock)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useGraphStore.getState().fetchFromSupabase(mapId)
    useGraphStore.setState({ campusReady: true })
    useGraphStore.getState().recordAuthoredMutation('building', buildingA, null)
    const graph = useGraphStore.getState().graph
    graph.setBuildings(graph.buildings.filter((building) => building.id !== buildingB))
    await useGraphStore.getState().save()

    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const guardWarning = warning.mock.calls.find(([message]) => message === '[graph-store] save blocked by safety guard')
    expect(guardWarning?.[1]).toMatchObject({
      acknowledgedBaselinePresent: true,
      pendingIntentPresent: true,
      previousSaveSucceeded: false,
      documentChangedAfterPreviousAck: false,
    })
    expect(JSON.stringify(guardWarning?.[1])).not.toContain(mapId)
    expect(JSON.stringify(guardWarning?.[1])).not.toContain(buildingB)
  })
})
