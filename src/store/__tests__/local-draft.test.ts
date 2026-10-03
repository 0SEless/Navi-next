import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'

/**
 * Phase 3B — local draft persistence is separate from server synchronization.
 * Provider-level behavior + source-contract checks that teardown paths no
 * longer initiate normal network saves.
 */

const MAP_ID = 'local-draft'
const CACHE_KEY = `navi-graph-${MAP_ID}`
const MARKER_KEY = `navi-sync-status-${MAP_ID}`

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({ id: 'building-1', name, campusId: MAP_ID, footprint: [] } as never)
  return graph
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function readMarker(): { serverTimestamp?: string | null } {
  return JSON.parse(localStorage.getItem(MARKER_KEY) ?? '{}')
}

describe('Phase 3B local draft persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('3B-A/B — draft is durable immediately with zero server contact', () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    useGraphStore.setState({ graph: makeGraph('Draft Hall'), currentMapId: MAP_ID })

    useGraphStore.getState().persistLocalDraft()

    expect(localStorage.getItem(CACHE_KEY)).toContain('Draft Hall')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useGraphStore.getState().syncStatus).toBe('idle') // no synced claim
  })

  it('3B-C — local draft does not advance the acknowledged marker', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ success: true, updatedAt: 'R1' })
      return jsonResponse(makeGraph('Base Hall').toJSON() as unknown as Record<string, unknown>)
    })
    vi.stubGlobal('fetch', fetchMock)

    // Establish an acknowledged base via the real save path.
    useGraphStore.setState({ graph: makeGraph('Base Hall'), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
    await useGraphStore.getState().save()
    expect(readMarker().serverTimestamp).toBe('R1')

    // Commit a newer local draft (no server sync).
    useGraphStore.setState({ graph: makeGraph('Edited Hall') })
    useGraphStore.getState().persistLocalDraft()

    expect(localStorage.getItem(CACHE_KEY)).toContain('Edited Hall')
    expect(readMarker().serverTimestamp).toBe('R1') // marker still represents the ack
  })

  it('3B-E/F — refresh before the 5s save preserves the draft and reload restores it from cache', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ success: true, updatedAt: 'R1' })
      return jsonResponse(makeGraph('Base Hall').toJSON() as unknown as Record<string, unknown>)
    })
    vi.stubGlobal('fetch', fetchMock)
    useGraphStore.setState({ graph: makeGraph('Base Hall'), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
    await useGraphStore.getState().save()

    // Commit B locally, then simulate refresh BEFORE the debounce fires.
    useGraphStore.setState({ graph: makeGraph('Draft Hall') })
    useGraphStore.getState().persistLocalDraft()
    const postsBeforeRefresh = fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method) === 'POST').length

    // Fresh page lifecycle: no network due to "unload" (none is initiated here),
    // then loadMapData must restore the draft from cache immediately.
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
    useGraphStore.getState().loadMapData(MAP_ID)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Draft Hall')

    const postsAfterReload = fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method) === 'POST').length
    expect(postsAfterReload).toBe(postsBeforeRefresh) // reload itself performed no POST
  })

  it('3B-D/G — Studio teardown stays local; floor exit saves are dirty and adoption guarded', () => {
    const editorBridge = fs.readFileSync(path.resolve(process.cwd(), 'src/components/studio/EditorBridge.tsx'), 'utf8')
    const floorPage = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/(admin)/studio/[id]/edit/building/[buildingId]/floor/[floor]/page.tsx'),
      'utf8',
    )

    // Both lifecycle owners ensure the LOCAL draft instead of calling save().
    expect(editorBridge).toContain('persistLocalDraft')
    expect(floorPage).toContain('persistLocalDraft')
    expect(/(handleBeforeUnload|handleVisibility)[\s\S]{0,700}?\.save\(/.test(editorBridge)).toBe(false)
    expect(floorPage).toContain('state.serverAdoptionVersion !== adoptionVersion')
    expect(floorPage).toContain('if (!isDirty && state.pendingAuthoredMutations.length === 0)')
  })

  it('3B-H — authoritative adoption replaces the draft; no resurrection', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ success: true, updatedAt: 'R5' })
      return jsonResponse({ ...(makeGraph('Server Truth').toJSON() as unknown as Record<string, unknown>), updatedAt: 'R5' })
    })
    vi.stubGlobal('fetch', fetchMock)

    useGraphStore.setState({ graph: makeGraph('Wild Draft'), currentMapId: MAP_ID, syncStatus: 'conflict', syncError: 'x' })
    useGraphStore.getState().persistLocalDraft()
    await useGraphStore.getState().adoptServerSnapshot()

    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Server Truth')
    expect(localStorage.getItem(CACHE_KEY)).toContain('Server Truth')
    expect(localStorage.getItem(CACHE_KEY)).not.toContain('Wild Draft')
    expect(readMarker().serverTimestamp).toBe('R5')
  })
})
