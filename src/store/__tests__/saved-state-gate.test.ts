import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Graph } from '../../engine/graph'
import { useGraphStore, __resetGraphSaveQueuesForTests } from '../graph-store'
import { deriveFloorHeaderStatus } from '@/hooks/floor-graph-selectors'
import { getSaveStatusModel } from '@/components/studio/save-status-model'

/**
 * False-saved gate: no surface may claim Saved from a marker, an optimistic
 * state, or an unconfirmed ACK. These cases exercise the graph store contract
 * and the derived badge inputs at the store level.
 */

const MAP_ID = 'saved-state-gate'
const CACHE_KEY = `navi-graph-${MAP_ID}`

function makeGraph(name: string): Graph {
  const graph = new Graph()
  graph.campusId = MAP_ID
  graph.addBuilding({
    id: 'building-1',
    name,
    campusId: MAP_ID,
    footprint: [],
  } as never)
  return graph
}

function serverPayload(name: string, updatedAt: string): Record<string, unknown> {
  return { ...(makeGraph(name).toJSON() as unknown as Record<string, unknown>), updatedAt }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setClientGraph(name: string): void {
  useGraphStore.setState({ graph: makeGraph(name), currentMapId: MAP_ID, syncStatus: 'idle', syncError: null })
}

function isPost(init?: RequestInit): boolean {
  return (init?.method ?? 'GET') === 'POST'
}

/** Seed a matching cache + marker through a normal acknowledged save. */
async function seedAcknowledgedSync(): Promise<void> {
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (isPost(init)) return jsonResponse({ success: true, updatedAt: 'R1' })
    return jsonResponse(serverPayload('Seed Hall', 'R1'))
  }))
  setClientGraph('Seed Hall')
  await useGraphStore.getState().save()
  expect(useGraphStore.getState().syncStatus).toBe('synced')
}

function reloadFromMarker(): void {
  useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  useGraphStore.getState().loadMapData(MAP_ID)
  // P0.14: model the real lifecycle — the fixture's campus is fully hydrated.
  useGraphStore.getState().completeCampusHydration()
}

describe('graph store false-saved gate', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
    __resetGraphSaveQueuesForTests()
    useGraphStore.setState({ graph: new Graph(), currentMapId: null, syncStatus: 'idle', syncError: null })
  })

  it('case 1/2: a committed local edit cannot keep a Saved badge during the debounce window', async () => {
    await seedAcknowledgedSync()

    // Graph mutators only bump renderVersion: syncStatus alone stays `synced`
    // across the autosave debounce, which is exactly the previous false-Saved.
    useGraphStore.getState().updateBuilding('building-1', { name: 'Edited Hall' } as never)
    expect(useGraphStore.getState().syncStatus).toBe('synced')

    expect(deriveFloorHeaderStatus('synced', 'dirty')).toBe('unsaved')
    expect(getSaveStatusModel({ saveState: 'dirty', syncStatus: 'synced' }).label).toBe('Unsaved changes')
  })

  it('case 4: a valid authoritative ACK allows Saved', async () => {
    await seedAcknowledgedSync()

    expect(useGraphStore.getState().syncStatus).toBe('synced')
    expect(deriveFloorHeaderStatus('synced', 'saved')).toBe('saved')
    expect(getSaveStatusModel({ saveState: 'saved', syncStatus: 'synced' }).label).toBe('All changes saved')
  })

  it('case 5: an ACK without a revision and a failed read-back can never show Saved', async () => {
    vi.useFakeTimers()
    try {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) return jsonResponse({ success: true })
      return jsonResponse({ error: 'read failed' }, 500)
    }))

    setClientGraph('Edit A')
    const savePromise = useGraphStore.getState().save()
    const rejection = expect(savePromise).rejects.toThrow(/could not be confirmed/i)
    await vi.advanceTimersByTimeAsync(47_000)
    await rejection

    const state = useGraphStore.getState()
    expect(state.syncStatus).toBe('error')
    expect(deriveFloorHeaderStatus('error', 'dirty')).toBe('error')
    expect(getSaveStatusModel({
      saveState: 'dirty',
      syncStatus: 'error',
      syncError: state.syncError,
    }).label).not.toBe('All changes saved')
    } finally {
      vi.useRealTimers()
    }
  })

  it('case 6: a malformed ACK can never show Saved', async () => {
    vi.useFakeTimers()
    try {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) return jsonResponse({ success: true, updatedAt: 42 })
      return jsonResponse({ error: 'read failed' }, 500)
    }))

    setClientGraph('Edit A')
    const savePromise = useGraphStore.getState().save()
    const rejection = expect(savePromise).rejects.toThrow(/could not be confirmed/i)
    await vi.advanceTimersByTimeAsync(47_000)
    await rejection

    expect(useGraphStore.getState().syncStatus).toBe('error')
    expect(deriveFloorHeaderStatus('error', 'saved')).toBe('error')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an A → B → A switch during legacy revision readback cannot relabel or clear the new A session', async () => {
    let releaseReadback!: (response: Response) => void
    const readback = new Promise<Response>((resolve) => { releaseReadback = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) return jsonResponse({ success: true })
      return readback
    }))

    setClientGraph('Old A edit')
    const oldSave = useGraphStore.getState().save()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    useGraphStore.getState().setCurrentMapId('map-b')
    useGraphStore.setState({ graph: makeGraph('Map B'), syncStatus: 'idle', syncError: null })
    useGraphStore.getState().setCurrentMapId(MAP_ID)
    useGraphStore.setState({
      graph: makeGraph('Reopened A edit'),
      syncStatus: 'idle',
      syncError: null,
      pendingAuthoredMutations: [],
      campusReady: true,
    })
    useGraphStore.getState().recordAuthoredMutation('building', 'reopened-building', null)
    releaseReadback(jsonResponse({ error: 'read failed' }, 500))

    await oldSave

    expect(useGraphStore.getState().currentMapId).toBe(MAP_ID)
    expect(useGraphStore.getState().syncStatus).toBe('idle')
    expect(useGraphStore.getState().syncError).toBeNull()
    expect(useGraphStore.getState().pendingAuthoredMutations).toHaveLength(1)
    expect(useGraphStore.getState().graph.buildings[0]?.name).toBe('Reopened A edit')
  })

  it('case 7: a transport failure can never show Saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }))

      setClientGraph('Offline edit')
      const savePromise = useGraphStore.getState().save()
      const rejection = expect(savePromise).rejects.toThrow(/Offline/)
      await vi.advanceTimersByTimeAsync(47_000)
      await rejection

      const state = useGraphStore.getState()
      expect(state.syncStatus).toBe('error')
      expect(state.syncError).toMatch(/^Offline/)
      expect(deriveFloorHeaderStatus('error', 'dirty')).toBe('error')
      expect(getSaveStatusModel({
        saveState: 'dirty',
        syncStatus: 'error',
        syncError: state.syncError,
      }).label).toBe('Saved on this device')
    } finally {
      vi.useRealTimers()
    }
  })

  it('case 8: a CAS conflict can never show Saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) {
        return jsonResponse(
          { error: 'The server changed since this editor loaded it. Your local changes were not overwritten.' },
          409,
        )
      }
      return jsonResponse(serverPayload('Server Hall', 'R1'))
    }))

    setClientGraph('Local authored work')
    await expect(useGraphStore.getState().save()).rejects.toThrow(/server changed/i)

    const state = useGraphStore.getState()
    expect(state.syncStatus).toBe('conflict')
    expect(state.graph.buildings[0]?.name).toBe('Local authored work')
    expect(deriveFloorHeaderStatus('conflict', 'dirty')).toBe('conflict')
    expect(getSaveStatusModel({
      saveState: 'dirty',
      syncStatus: 'conflict',
      syncError: state.syncError,
    }).label).toBe('Changes not synced')
  })

  it('case 10: a marker-matched reload stays checking (never Saved) until the server settles it', async () => {
    await seedAcknowledgedSync()

    let releaseGet: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) return Promise.resolve(jsonResponse({ success: true, updatedAt: 'R1' }))
      return new Promise<Response>((resolve) => {
        releaseGet = resolve
      })
    }))

    reloadFromMarker()

    expect(useGraphStore.getState().syncStatus).toBe('checking')
    expect(deriveFloorHeaderStatus('checking', 'saved')).toBe('checking')
    expect(getSaveStatusModel({ saveState: 'saved', syncStatus: 'checking' }).label).toBe('Checking server…')

    // Settle with an empty server so `checking` can never stick.
    releaseGet?.(jsonResponse({ buildings: [], nodes: [], edges: [] }))
    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('idle')
    })
  })

  it('case 11: a failed freshness check after a marker-matched reload can never show Saved', async () => {
    await seedAcknowledgedSync()

    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) return jsonResponse({ success: true, updatedAt: 'R2' })
      throw new TypeError('Failed to fetch')
    }))

    reloadFromMarker()
    expect(useGraphStore.getState().syncStatus).toBe('checking')

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('error')
    })
    const state = useGraphStore.getState()
    expect(state.syncError).toMatch(/^Offline — could not verify the server copy/)
    expect(deriveFloorHeaderStatus('error', 'saved')).toBe('error')
    expect(getSaveStatusModel({
      saveState: 'saved',
      syncStatus: 'error',
      syncError: state.syncError,
    }).label).not.toBe('All changes saved')
  })

  it('case 12: a marker-matched reload confirmed equal by the server may show Saved', async () => {
    await seedAcknowledgedSync()
    const cached = localStorage.getItem(CACHE_KEY)
    expect(cached).not.toBeNull()

    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) return jsonResponse({ success: true, updatedAt: 'R1' })
      return jsonResponse(JSON.parse(cached ?? '{}'))
    }))

    reloadFromMarker()
    expect(useGraphStore.getState().syncStatus).toBe('checking')

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('synced')
    })
    expect(deriveFloorHeaderStatus('synced', 'saved')).toBe('saved')
    expect(getSaveStatusModel({ saveState: 'saved', syncStatus: 'synced' }).label).toBe('All changes saved')
  })

  it('keeps a marker-stamped reload out of Saved when the server copy is empty', async () => {
    await seedAcknowledgedSync()

    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isPost(init)) return jsonResponse({ success: true, updatedAt: 'R1' })
      return jsonResponse({ buildings: [], nodes: [], edges: [] })
    }))

    reloadFromMarker()
    expect(useGraphStore.getState().syncStatus).toBe('checking')

    await vi.waitFor(() => {
      expect(useGraphStore.getState().syncStatus).toBe('idle')
    })
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull()
    expect(deriveFloorHeaderStatus('idle', 'saved')).toBe('unsaved')
  })
})
