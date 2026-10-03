import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from './graph-store'

const MAP_ID = 'conflict-map'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(buildingName: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({
    id: 'building-1',
    name: buildingName,
    campusId: MAP_ID,
    footprint: [],
  } as never)
  return graph
}

function serverPayload(buildingName: string, updatedAt: string): Record<string, unknown> {
  return { ...(makeGraph(buildingName).toJSON() as unknown as Record<string, unknown>), updatedAt }
}

function floorGraph(buildingName: string, server: boolean): Graph {
  const graph = makeGraph(buildingName)
  graph.updateBuilding('building-1', {
    floorData: [0, 1, 2].map((level) => ({
      id: `floor-${level}`,
      level,
      planImageId: server ? `server-plan-${level}` : level === 0 ? 'local-plan-0' : null,
      planAlignment: server
        ? { offset: { x: level + 1, y: level + 2 }, scaleX: 1.1 + level / 100, scaleY: 1.5 + level / 10, rotation: level, opacity: 0.7, locked: false }
        : level === 0 ? { offset: { x: 99, y: 99 }, scale: 2, rotation: 42, opacity: 0.5 } : null,
      locked: server || level === 0,
      floorPlanState: server ? 'active' : level === 0 ? 'active' : 'none',
      walls: server && level === 0 ? Array.from({ length: 7 }, (_, index) => ({ id: `server-wall-${index}` })) : [],
    })),
  })
  graph.setDoors(server ? [{
    id: 'server-door',
    buildingId: 'building-1',
    floor: 0,
    position: { lat: 1, lng: 2 },
    width: 1,
  }] : [])
  return graph
}

function authoredDocument(name: string) {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: MAP_ID,
      name,
      description: `${name} description`,
      lastModified: '2026-09-12T10:00:00.000Z',
      editorVersion: 'adoption-test',
    },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function stubServer(
  payload: Record<string, unknown>,
  options?: { failGet?: boolean; postCounter?: { count: number }; postUpdatedAt?: string; postedBodies?: string[] },
) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'POST') {
      if (options?.postCounter) options.postCounter.count += 1
      if (typeof init?.body === 'string') options?.postedBodies?.push(init.body)
      return new Response(JSON.stringify(options?.postUpdatedAt ? { updatedAt: options.postUpdatedAt } : {}), { status: 200 })
    }
    if (options?.failGet) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function seedCleanLocal(buildingName: string): Promise<void> {
  stubServer(serverPayload(buildingName, '2026-09-12T09:00:00.000Z'))
  useGraphStore.setState({ graph: makeGraph(buildingName), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
  await useGraphStore.getState().save()
}

function rewriteLocalCache(buildingName: string): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(makeGraph(buildingName).toJSON()))
}

async function loadFresh(): Promise<void> {
  useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  useGraphStore.getState().loadMapData(MAP_ID)
  await vi.waitFor(() => {
    expect(useGraphStore.getState().currentMapId).toBe(MAP_ID)
  })
  // P0.14: model the real lifecycle — the fixture's campus is fully hydrated.
  useGraphStore.getState().completeCampusHydration()
}

describe('graph store stale-local conflict handling', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('stamps the sync marker only with a server-confirmed revision, never the local clock', async () => {
    await seedCleanLocal('Local Hall')
    const marker = JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
    // The legacy RPC does not echo updatedAt; the revision must still come from
    // the server (GET confirmation), never from the local clock.
    expect(marker.serverTimestamp).toBe('2026-09-12T09:00:00.000Z')
    expect(typeof marker.syncedAt).toBe('string')
    expect(marker.serverTimestamp).not.toBe(marker.syncedAt)
  })

  it('adopts a differing server snapshot when the local copy is clean', async () => {
    await seedCleanLocal('Local Hall')
    stubServer(serverPayload('Server Hall', '2026-09-12T10:00:00.000Z'))

    await loadFresh()

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('synced')
      expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Server Hall')
    })
    const marker = JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
    expect(marker.serverTimestamp).toBe('2026-09-12T10:00:00.000Z')
  })

  it('keeps a clean local snapshot when a stale server response is older than the last server revision', async () => {
    await seedCleanLocal('Local Hall')
    const marker = JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
    localStorage.setItem(MARKER_KEY, JSON.stringify({ ...marker, serverTimestamp: '2026-09-12T10:00:00.000Z' }))
    stubServer(serverPayload('Older Server Hall', '2026-09-12T09:00:00.000Z'))

    await loadFresh()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Local Hall')
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('sends the last server revision on save and records the revision returned by the server', async () => {
    await seedCleanLocal('Local Hall')
    const marker = JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
    localStorage.setItem(MARKER_KEY, JSON.stringify({ ...marker, serverTimestamp: '2026-09-12T10:00:00.000Z' }))
    const postedBodies: string[] = []
    stubServer(serverPayload('Local Hall', '2026-09-12T10:00:00.000Z'), { postedBodies, postUpdatedAt: '2026-09-12T11:00:00.000Z' })

    useGraphStore.setState({ graph: makeGraph('Local Hall'), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
    await useGraphStore.getState().save()

    expect(JSON.parse(postedBodies[0])).toMatchObject({ expectedServerUpdatedAt: '2026-09-12T10:00:00.000Z' })
    expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe('2026-09-12T11:00:00.000Z')
  })

  it('keeps the dirty local snapshot and reports a conflict when the server differs', async () => {
    await seedCleanLocal('Local Hall')
    rewriteLocalCache('Local Hall Edited')
    const postCounter = { count: 0 }
    stubServer(serverPayload('Server Hall', '2026-09-12T10:00:00.000Z'), { postCounter })

    await loadFresh()

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('conflict')
    })
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Local Hall Edited')
    expect(useGraphStore.getState().syncError).toMatch(/different version/)

    await expect(useGraphStore.getState().syncToSupabase()).rejects.toThrow(/different version/)
    expect(postCounter.count).toBe(0)
  })

  it('adoptServerSnapshot loads the server version without duplicating the full local graph', async () => {
    await seedCleanLocal('Local Hall')
    rewriteLocalCache('Local Hall Edited')
    stubServer(serverPayload('Server Hall', '2026-09-12T10:00:00.000Z'))

    await loadFresh()
    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('conflict')
    })

    await useGraphStore.getState().adoptServerSnapshot()

    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Server Hall')
    expect(localStorage.getItem(CACHE_KEY)).toContain('Server Hall')
    expect(localStorage.getItem(`navi-graph-backup-${MAP_ID}`)).toBeNull()
  })

  it('replaces all three floors and the GF door from the authoritative server graph', async () => {
    const localGraph = floorGraph('Local Hall Edited', false)
    const serverGraph = floorGraph('Server Hall', true)
    const serverAuthoredDocument = authoredDocument('Server Authored Hall')
    localStorage.setItem(CACHE_KEY, JSON.stringify(localGraph.toJSON()))
    useGraphStore.setState({ graph: localGraph, authoredDocument: authoredDocument('Local Authored Hall'), currentMapId: MAP_ID, syncStatus: 'conflict', syncError: 'Server differs' })
    stubServer({
      ...(serverGraph.toJSON() as unknown as Record<string, unknown>),
      updatedAt: '2026-09-12T10:00:00.000Z',
      authoredDocumentFormatVersion: 1,
      authoredDocument: serverAuthoredDocument,
    })

    await useGraphStore.getState().adoptServerSnapshot()

      const adopted = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
      const floors = adopted.buildings[0].floorData
      expect(floors).toHaveLength(3)
      expect(floors.map((floor: { id: string }) => floor.id)).toEqual(['floor-0', 'floor-1', 'floor-2'])
      expect(floors.map((floor: { planImageId: string }) => floor.planImageId)).toEqual(['server-plan-0', 'server-plan-1', 'server-plan-2'])
    expect(floors.map((floor: { planAlignment: unknown }) => floor.planAlignment)).toEqual([
      { offset: { x: 1, y: 2 }, scaleX: 1.1, scaleY: 1.5, rotation: 0, opacity: 0.7, locked: false },
      { offset: { x: 2, y: 3 }, scaleX: 1.11, scaleY: 1.6, rotation: 1, opacity: 0.7, locked: false },
      { offset: { x: 3, y: 4 }, scaleX: 1.12, scaleY: 1.7, rotation: 2, opacity: 0.7, locked: false },
    ])
    expect(floors[0].walls).toHaveLength(7)
    expect(adopted.doors).toEqual([{
      id: 'server-door',
      buildingId: 'building-1',
      floor: 0,
      position: { lat: 1, lng: 2 },
      width: 1,
      }])
      expect(floors.map((floor: { locked: boolean }) => floor.locked)).toEqual([true, true, true])
      expect(floors.map((floor: { floorPlanState: string }) => floor.floorPlanState)).toEqual(['active', 'active', 'active'])
    expect(adopted.authoredDocument.metadata.name).toBe('Server Authored Hall')
    expect(useGraphStore.getState().authoredDocument?.metadata.name).toBe('Server Authored Hall')
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('does not advance the server marker or clear conflict when the adopted cache cannot be written', async () => {
    const oldServerTimestamp = '2026-09-12T09:00:00.000Z'
    const localGraph = makeGraph('Local Hall Edited')
    localStorage.setItem(CACHE_KEY, JSON.stringify(localGraph.toJSON()))
    localStorage.setItem(MARKER_KEY, JSON.stringify({ snapshotFingerprint: 'local-fingerprint', serverTimestamp: oldServerTimestamp }))
    useGraphStore.setState({ graph: localGraph, currentMapId: MAP_ID, syncStatus: 'conflict', syncError: 'Server differs' })
    stubServer(serverPayload('Server Hall', '2026-09-12T10:00:00.000Z'))

    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === CACHE_KEY && value.includes('Server Hall')) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      }
      return originalSetItem.call(this, key, value)
    })

    await expect(useGraphStore.getState().adoptServerSnapshot()).rejects.toThrow(/storage|quota|adopt/i)

    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}').buildings[0]?.name).toBe('Local Hall Edited')
    expect(JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}').serverTimestamp).toBe(oldServerTimestamp)
    expect(useGraphStore.getState().syncStatus).toBe('conflict')
    expect(useGraphStore.getState().syncError).toMatch(/server|adopt|storage/i)
  })

  it('does not apply a late server response after Studio navigates to another campus', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    useGraphStore.setState({ graph: makeGraph('Local Hall'), currentMapId: MAP_ID, syncStatus: 'conflict', syncError: 'Server differs' })

    const adoption = useGraphStore.getState().adoptServerSnapshot()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    useGraphStore.setState({ graph: makeGraph('Other Campus'), currentMapId: 'other-campus', syncStatus: 'idle', syncError: null })
    resolveResponse?.(new Response(JSON.stringify(serverPayload('Server Hall', '2026-09-12T10:00:00.000Z')), { status: 200 }))

    await expect(adoption).rejects.toThrow(/navigated to another campus/i)
    expect(useGraphStore.getState().currentMapId).toBe('other-campus')
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Other Campus')
    expect(useGraphStore.getState().syncStatus).toBe('idle')
  })

  it('reSync refuses to overwrite a differing server snapshot unless forced', async () => {
    await seedCleanLocal('Local Hall')
    rewriteLocalCache('Local Hall Edited')
    const postCounter = { count: 0 }
    stubServer(serverPayload('Server Hall', '2026-09-12T10:00:00.000Z'), { postCounter })

    useGraphStore.setState({ graph: new Graph(), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
    await expect(useGraphStore.getState().reSync()).rejects.toThrow(/refused/)
    expect(postCounter.count).toBe(0)
    expect(useGraphStore.getState().syncStatus).toBe('conflict')

    await useGraphStore.getState().reSync({ force: true })
    expect(postCounter.count).toBe(1)
    expect(useGraphStore.getState().syncStatus).toBe('synced')
  })

  it('keeps the local snapshot but reports an unverified server copy when the check fails (offline fallback)', async () => {
    await seedCleanLocal('Local Hall')
    rewriteLocalCache('Local Hall Edited')
    stubServer(serverPayload('Server Hall', '2026-09-12T10:00:00.000Z'), { failGet: true })

    await loadFresh()

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('error')
    })
    expect(useGraphStore.getState().syncStatus).not.toBe('synced')
    expect(useGraphStore.getState().syncError).toMatch(/^Offline — could not verify the server copy/)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Local Hall Edited')
  })

  it('marks synced when the server content matches the local snapshot', async () => {
    await seedCleanLocal('Local Hall')
    localStorage.removeItem(MARKER_KEY)
    stubServer(serverPayload('Local Hall', '2026-09-12T10:00:00.000Z'))

    await loadFresh()
    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('synced')
    })
    const marker = JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
    expect(marker.serverTimestamp).toBe('2026-09-12T10:00:00.000Z')
  })
})
