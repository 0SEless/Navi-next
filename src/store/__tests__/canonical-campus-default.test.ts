import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryCampusCacheRepository } from '@/features/public-campus/cache'
import { parseQrPayload, QR_DEFAULT_CAMPUS } from '@/lib/qr-payload'
import { createPublicStore } from '../public-store'

const canonicalCampusId = 'map-map-1-repe'

function publicCampusResponse(campusId: string) {
  return new Response(JSON.stringify({
    campusId,
    campusName: 'NAVI Campus',
    source: 'graph_snapshots',
    revision: null,
    buildings: [{ id: 'building-1', name: 'Main Hall', floors: [{ level: 0 }] }],
    components: [],
    doors: [],
    nodes: [],
    edges: [],
    traces: [],
    pois: [],
    boundary: null,
    artifacts: null,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installPublicCampusFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const requestedCampus = new URL(String(input), 'http://localhost')
      .searchParams.get('campus_id') ?? ''
    return publicCampusResponse(requestedCampus)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('canonical User App campus default', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_CAMPUS_ID', '')
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('uses the canonical campus rather than a stale saved test campus', async () => {
    localStorage.setItem('navi-default-campus', 'dev-map-map-1-9ke4')
    localStorage.setItem('navi-selected-campus', 'rehearsal-campus-2026-09-19')
    const fetchMock = installPublicCampusFetch()
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })

    expect(store.getState().defaultCampusId).toBe(canonicalCampusId)
    await store.getState().fetchCampusData()

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public-campus?campus_id=${canonicalCampusId}`,
    )
    expect(store.getState().currentCampusId).toBe(canonicalCampusId)
  })

  it('uses the environment-configured canonical campus when one is set', async () => {
    const configuredCampusId = 'campus-from-runtime-config'
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_CAMPUS_ID', configuredCampusId)
    localStorage.setItem('navi-default-campus', 'dev-map-map-1-9ke4')
    const fetchMock = installPublicCampusFetch()
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })

    expect(store.getState().defaultCampusId).toBe(configuredCampusId)
    await store.getState().fetchCampusData()

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public-campus?campus_id=${configuredCampusId}`,
    )
    expect(store.getState().currentCampusId).toBe(configuredCampusId)
  })

  it('retains an explicit default selection created under the active canonical configuration', () => {
    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
    store.getState().setDefaultCampus('explicit-user-selection')

    const reloadedStore = createPublicStore({ cache: createMemoryCampusCacheRepository() })

    expect(reloadedStore.getState().defaultCampusId).toBe('explicit-user-selection')
  })

  it('routes campus-less legacy QR payloads to the canonical campus', () => {
    expect(QR_DEFAULT_CAMPUS).toBe(canonicalCampusId)
    expect(parseQrPayload('node-1')).toEqual({
      campusId: canonicalCampusId,
      nodeId: 'node-1',
    })
    expect(parseQrPayload('https://navi.app/?node=node-1')).toEqual({
      campusId: canonicalCampusId,
      nodeId: 'node-1',
    })
  })
})
