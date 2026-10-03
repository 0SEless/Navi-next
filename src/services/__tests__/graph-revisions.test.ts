import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listGraphRevisions, restoreGraphRevision } from '../graph-revisions'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listGraphRevisions', () => {
  it('returns typed revision summaries for a successful list', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        campus_id: 'map-map-1-k6bv',
        revisions: [
          {
            id: 42,
            campus_id: 'map-map-1-k6bv',
            revision: '2026-09-15T01:02:03.000Z',
            parent_revision: '2026-09-14T00:00:00.000Z',
            checksum: 'a1b2',
            created_at: '2026-09-15T01:02:04.000Z',
            created_by: 'api',
            source: 'autosave',
            metadata: { buildingCount: 29, nodeCount: 53, edgeCount: 50 },
          },
          {
            id: 41,
            campus_id: 'map-map-1-k6bv',
            revision: '2026-09-14T00:00:00.000Z',
            parent_revision: null,
            checksum: 'c3d4',
            created_at: '2026-09-14T00:00:01.000Z',
            created_by: 'api',
            source: 'manual',
            metadata: {},
          },
        ],
      }),
    )

    const result = await listGraphRevisions('map-map-1-k6bv')

    expect(result).toEqual({
      status: 'ok',
      campusId: 'map-map-1-k6bv',
      revisions: [
        {
          id: 42,
          campusId: 'map-map-1-k6bv',
          revision: '2026-09-15T01:02:03.000Z',
          parentRevision: '2026-09-14T00:00:00.000Z',
          checksum: 'a1b2',
          createdAt: '2026-09-15T01:02:04.000Z',
          createdBy: 'api',
          source: 'autosave',
          metadata: { buildingCount: 29, nodeCount: 53, edgeCount: 50 },
        },
        {
          id: 41,
          campusId: 'map-map-1-k6bv',
          revision: '2026-09-14T00:00:00.000Z',
          parentRevision: null,
          checksum: 'c3d4',
          createdAt: '2026-09-14T00:00:01.000Z',
          createdBy: 'api',
          source: 'manual',
          metadata: {},
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/graph-revisions?campus_id=map-map-1-k6bv', {
      credentials: 'include',
    })
  })

  it('encodes the campus id and forwards the limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, campus_id: 'campus 1', revisions: [] }))

    const result = await listGraphRevisions('campus 1', { limit: 25 })

    expect(result).toEqual({ status: 'ok', campusId: 'campus 1', revisions: [] })
    expect(fetchMock).toHaveBeenCalledWith('/api/graph-revisions?campus_id=campus+1&limit=25', {
      credentials: 'include',
    })
  })

  it('maps 401 to unauthorized', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Authentication required' }))

    const result = await listGraphRevisions('map-map-1-k6bv')

    expect(result).toEqual({ status: 'unauthorized', message: 'Authentication required' })
  })

  it('maps a protected-campus 403 to unauthorized', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Campus is protected' }))

    const result = await listGraphRevisions('map-map-1-k6bv')

    expect(result).toEqual({ status: 'unauthorized', message: 'Campus is protected' })
  })

  it('maps server failures to a typed error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'revision ledger unavailable' }))

    const result = await listGraphRevisions('map-map-1-k6bv')

    expect(result).toEqual({ status: 'error', message: 'revision ledger unavailable' })
  })

  it('rejects a non-JSON response body', async () => {
    fetchMock.mockResolvedValue(new Response('not-json', { status: 200 }))

    const result = await listGraphRevisions('map-map-1-k6bv')

    expect(result).toEqual({ status: 'error', message: 'Malformed revision history response' })
  })

  it('rejects malformed revision entries', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { revisions: [{ id: 'not-a-number' }] }))

    const result = await listGraphRevisions('map-map-1-k6bv')

    expect(result).toEqual({ status: 'error', message: 'Malformed revision history response' })
  })

  it('rejects an empty campus id without calling fetch', async () => {
    const result = await listGraphRevisions('   ')

    expect(result).toEqual({ status: 'error', message: 'campusId is required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps network failures to a typed error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const result = await listGraphRevisions('map-map-1-k6bv')

    expect(result).toEqual({ status: 'error', message: 'fetch failed' })
  })
})

describe('restoreGraphRevision', () => {
  it('posts the CAS payload and returns the new revision', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        campus_id: 'map-map-1-k6bv',
        updatedAt: '2026-09-15T02:00:00.000Z',
        restored_from: '2026-09-13T10:10:07.456350Z',
      }),
    )

    const result = await restoreGraphRevision({
      campusId: 'map-map-1-k6bv',
      revision: '2026-09-13T10:10:07.456350Z',
      expectedCurrent: '2026-09-15T01:02:03.000Z',
    })

    expect(result).toEqual({
      status: 'restored',
      campusId: 'map-map-1-k6bv',
      updatedAt: '2026-09-15T02:00:00.000Z',
      restoredFrom: '2026-09-13T10:10:07.456350Z',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/graph-revisions/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        campusId: 'map-map-1-k6bv',
        revision: '2026-09-13T10:10:07.456350Z',
        expectedCurrent: '2026-09-15T01:02:03.000Z',
      }),
    })
  })

  it('sends a null expectedCurrent when no revision was observed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, updatedAt: 'R1', restored_from: 'R0' }),
    )

    const result = await restoreGraphRevision({ campusId: 'campus', revision: 'R0', expectedCurrent: null })

    expect(result).toEqual({ status: 'restored', campusId: 'campus', updatedAt: 'R1', restoredFrom: 'R0' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      campusId: 'campus',
      revision: 'R0',
      expectedCurrent: null,
    })
  })

  it('maps a stale-revision 409 to conflict', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'The server changed since this editor loaded it.' }),
    )

    const result = await restoreGraphRevision({
      campusId: 'map-map-1-k6bv',
      revision: 'R0',
      expectedCurrent: 'R1',
    })

    expect(result).toEqual({ status: 'conflict', message: 'The server changed since this editor loaded it.' })
  })

  it('maps a protected-campus 403 to unauthorized', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Restore denied for protected campus' }))

    const result = await restoreGraphRevision({ campusId: 'protected', revision: 'R0', expectedCurrent: null })

    expect(result).toEqual({ status: 'unauthorized', message: 'Restore denied for protected campus' })
  })

  it('rejects a malformed success body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }))

    const result = await restoreGraphRevision({ campusId: 'campus', revision: 'R0', expectedCurrent: null })

    expect(result).toEqual({ status: 'error', message: 'Malformed restore response' })
  })

  it('rejects non-JSON success bodies', async () => {
    fetchMock.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }))

    const result = await restoreGraphRevision({ campusId: 'campus', revision: 'R0', expectedCurrent: null })

    expect(result).toEqual({ status: 'error', message: 'Malformed restore response' })
  })

  it('rejects missing input without calling fetch', async () => {
    const result = await restoreGraphRevision({ campusId: 'campus', revision: '  ', expectedCurrent: null })

    expect(result).toEqual({ status: 'error', message: 'revision is required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps network failures to a typed error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const result = await restoreGraphRevision({ campusId: 'campus', revision: 'R0', expectedCurrent: null })

    expect(result).toEqual({ status: 'error', message: 'fetch failed' })
  })
})
