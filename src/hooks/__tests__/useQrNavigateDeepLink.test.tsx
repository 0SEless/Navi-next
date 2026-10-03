import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQrNavigateDeepLink } from '../useQrNavigateDeepLink'
import { usePublicStore } from '@/store/public-store'
import type { CampusBundle, NavNode } from '@/types/nav-types'
import type { QrIndexEntry } from '@navi/core'

const navigation = vi.hoisted(() => ({ pathname: '/map/navigate' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  navigation.pathname = '/map/navigate'
  window.history.replaceState({}, '', '/map/navigate')
  usePublicStore.setState({
    campus: null,
    campusData: null,
    currentCampusId: null,
    defaultCampusId: null,
    campusLoading: false,
    campusStatus: 'idle',
    campusError: null,
    campusOrigin: null,
    campusRevision: null,
    qrLocation: null,
    fromNode: null,
    toNode: null,
  })
})

const destination = (campusId: string): NavNode => ({
  id: `${campusId}-destination`,
  label: 'Library',
  position: { lat: 10.001, lng: 20 },
  floor: 0,
  buildingId: 'building-1',
  campusId,
  type: 'room',
})

function checkpoint(campusId: string, id = `${campusId}-checkpoint`): QrIndexEntry {
  return {
    id,
    label: 'Main Entrance',
    buildingId: 'building-1',
    floor: 0,
    position: { x: 0, y: 0 },
    code: `navi.app/q/${id}`,
  }
}

function makeCampus(campusId: string): CampusBundle {
  const entry = checkpoint(campusId)
  const qrNode: NavNode = {
    id: `${campusId}-qr-node`,
    label: entry.label,
    position: { lat: 10, lng: 20 },
    floor: 0,
    buildingId: 'building-1',
    campusId,
    type: 'entrance',
    metadata: { entityType: 'qr', entityId: entry.id },
  }
  return {
    nodes: [qrNode, destination(campusId)],
    edges: [],
    searchEntries: [{
      id: `${campusId}-destination-entry`,
      label: 'Library',
      type: 'room',
      nodeId: `${campusId}-destination`,
      buildingId: 'building-1',
      floor: 0,
    }],
    buildings: [{
      id: 'building-1',
      name: 'Main Building',
      campusId,
      floors: [0],
      footprint: [],
      baseElevation: 0,
      height: 10,
    }],
    poi: [],
    boundingBox: null,
    qrIndex: {
      schemaVersion: 1,
      formatVersion: 1,
      campusId,
      checkpoints: [entry],
    },
  }
}

function setReadyCampus(campusId: string, overrides: Partial<ReturnType<typeof usePublicStore.getState>> = {}) {
  const bundle = makeCampus(campusId)
  usePublicStore.setState({
    campus: bundle,
    currentCampusId: campusId,
    campusData: {
      campusId,
      source: 'published_maps',
      buildings: bundle.buildings,
      components: [],
      nodes: bundle.nodes,
      edges: bundle.edges,
    },
    defaultCampusId: 'campus-a',
    campusLoading: false,
    campusStatus: 'ready',
    campusError: null,
    campusOrigin: 'network',
    campusRevision: campusId,
    qrLocation: null,
    fromNode: null,
    toNode: null,
    ...overrides,
  })
}

describe('useQrNavigateDeepLink', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/map/navigate')
  })

  it('resolves a same-campus QR once, preserves to, and removes only qr after success', async () => {
    const campus = makeCampus('campus-a')
    const toNodeId = 'campus-a-destination'
    setReadyCampus('campus-a')
    window.history.replaceState({}, '', `/map/navigate?qr=${campus.qrIndex!.checkpoints[0].id}&to=${toNodeId}`)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(() => useQrNavigateDeepLink())
    await waitFor(() => expect(result.current.status).toBe('resolved'))
    rerender()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(usePublicStore.getState().qrLocation).toMatchObject({
      checkpointId: 'campus-a-checkpoint',
      nodeId: 'campus-a-qr-node',
      anchor: 'graph-node',
    })
    expect(usePublicStore.getState().fromNode).toBe('campus-a-qr-node')
    expect(usePublicStore.getState().toNode).toBe(toNodeId)
    expect(window.location.pathname).toBe('/map/navigate')
    expect(window.location.search).toBe(`?to=${toNodeId}`)
  })

  it('discovers and hydrates a cross-campus QR without changing the saved default campus', async () => {
    setReadyCampus('campus-a', { fromNode: 'campus-a-existing' })
    const campusB = makeCampus('campus-b')
    const entry = campusB.qrIndex!.checkpoints[0]
    window.history.replaceState({}, '', `/map/navigate?qr=${entry.id}`)
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, window.location.origin)
      if (parsed.pathname === '/api/public-qr') {
        return new Response(JSON.stringify({ status: 'resolved', campusId: 'campus-b', checkpoint: entry }), { status: 200 })
      }
      return new Response(JSON.stringify({
        campusId: 'campus-b',
        source: 'published',
        revision: 'campus-b',
        nodes: campusB.nodes,
        edges: campusB.edges,
        buildings: campusB.buildings,
        components: [],
        artifacts: { qrIndex: campusB.qrIndex },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useQrNavigateDeepLink())
    await waitFor(() => expect(result.current.status).toBe('resolved'))

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/api/public-qr?checkpoint_id=campus-b-checkpoint'),
      expect.stringContaining('/api/public-campus?campus_id=campus-b'),
    ])
    expect(usePublicStore.getState().currentCampusId).toBe('campus-b')
    expect(usePublicStore.getState().defaultCampusId).toBe('campus-a')
    expect(usePublicStore.getState().fromNode).toBe('campus-b-qr-node')
    expect(window.location.search).toBe('')
  })

  it('reports campus unavailability and preserves the prior valid campus on failed cross-campus hydration', async () => {
    setReadyCampus('campus-a', { fromNode: 'campus-a-existing' })
    window.history.replaceState({}, '', '/map/navigate?qr=campus-b-checkpoint')
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, window.location.origin)
      if (parsed.pathname === '/api/public-qr') {
        return new Response(JSON.stringify({
          status: 'resolved',
          campusId: 'campus-b',
          checkpoint: checkpoint('campus-b'),
        }), { status: 200 })
      }
      return new Response('unavailable', { status: 503 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useQrNavigateDeepLink())
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current).toMatchObject({ status: 'error', reason: 'unavailable' })
    expect(usePublicStore.getState().currentCampusId).toBe('campus-a')
    expect(usePublicStore.getState().campus?.qrIndex?.campusId).toBe('campus-a')
    expect(usePublicStore.getState().fromNode).toBe('campus-a-existing')
    expect(usePublicStore.getState().defaultCampusId).toBe('campus-a')
    expect(window.location.search).toBe('?qr=campus-b-checkpoint')
  })

  it('surfaces a valid checkpoint without a routing anchor without mutating navigation state', async () => {
    const nonRoutableCampus = makeCampus('campus-a')
    nonRoutableCampus.nodes = [destination('campus-a')]
    setReadyCampus('campus-a', {
      campus: nonRoutableCampus,
      fromNode: 'existing-origin',
      toNode: 'existing-destination',
    })
    window.history.replaceState({}, '', '/map/navigate?qr=campus-a-checkpoint')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useQrNavigateDeepLink())
    await waitFor(() => expect(result.current.status).toBe('non-routable'))

    expect(result.current).toMatchObject({
      status: 'non-routable',
      location: { checkpointId: 'campus-a-checkpoint', nodeId: null, anchor: 'none' },
    })
    expect(usePublicStore.getState().fromNode).toBe('existing-origin')
    expect(usePublicStore.getState().toNode).toBe('existing-destination')
    expect(usePublicStore.getState().qrLocation).toBeNull()
    expect(window.location.search).toBe('?qr=campus-a-checkpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed for an invalid QR link without fetching or mutating location state', async () => {
    setReadyCampus('campus-a')
    window.history.replaceState({}, '', '/map/navigate?qr=javascript%3Aalert(1)')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useQrNavigateDeepLink())
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current).toMatchObject({ status: 'error', reason: 'invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(usePublicStore.getState().qrLocation).toBeNull()
    expect(window.location.search).toBe('?qr=javascript%3Aalert(1)')
  })

  it('does not retain a prior QR error after leaving Explore and returning to Navigate without QR', async () => {
    setReadyCampus('campus-a')
    window.history.replaceState({}, '', '/map/navigate?qr=campus-a-missing')
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ status: 'unknown' }), { status: 200 })
    )))
    const { result, rerender } = renderHook(() => useQrNavigateDeepLink())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current).toMatchObject({ status: 'error', reason: 'unknown' })

    navigation.pathname = '/map/explore'
    window.history.replaceState({}, '', '/map/explore')
    rerender()
    navigation.pathname = '/map/navigate'
    window.history.replaceState({}, '', '/map/navigate')
    rerender()

    expect(result.current.status).toBe('idle')
    expect(usePublicStore.getState().qrLocation).toBeNull()
  })

  it('starts idle on a fresh Navigate mount without a QR parameter', () => {
    setReadyCampus('campus-a')
    window.history.replaceState({}, '', '/map/navigate')

    const { result } = renderHook(() => useQrNavigateDeepLink())

    expect(result.current.status).toBe('idle')
    expect(usePublicStore.getState().qrLocation).toBeNull()
  })
})
