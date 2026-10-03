import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { CAPTURE_SCHEMA_VERSION, type CaptureSession } from '../../capture/types'
import { hashCaptureSession } from '../hash'
import {
  CAPTURE_SESSIONS_TABLE,
  createSupabaseCaptureRepository,
} from '../supabase-repository'

type FakeError = {
  code?: string
  message?: string
  name?: string
  status?: number
}

type FakeRow = Record<string, unknown>

const session: CaptureSession = {
  schemaVersion: CAPTURE_SCHEMA_VERSION,
  id: 'capture-1',
  title: 'North walkway survey',
  campusId: 'campus-1',
  status: 'finished',
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T08:15:00.000Z',
  startedAt: '2026-08-31T08:00:00.000Z',
  finishedAt: '2026-08-31T08:15:00.000Z',
  rawSamples: [
    {
      sequence: 0,
      timestamp: '2026-08-31T08:00:00.000Z',
      latitude: 14.5995,
      longitude: 120.9842,
      accuracy: 4.5,
      altitude: 12,
      altitudeAccuracy: 3,
      heading: 90,
      speed: 1.2,
    },
    {
      sequence: 1,
      timestamp: '2026-08-31T08:00:05.000Z',
      latitude: 14.5996,
      longitude: 120.9843,
      accuracy: 5,
      altitude: 12.2,
      altitudeAccuracy: 3.2,
      heading: 92,
      speed: 1.1,
    },
  ],
  candidateRoute: {
    points: [
      { latitude: 14.5995, longitude: 120.9842 },
      { latitude: 14.5996, longitude: 120.9843 },
    ],
    sourceSampleIndices: [0, 1],
    edgeCount: 1,
    derivedFromSampleCount: 2,
    derivedAt: '2026-08-31T08:15:01.000Z',
    algorithmVersion: 'capture-v1',
  },
  markers: [
    {
      id: 'marker-1',
      type: 'panorama',
      position: { latitude: 14.59955, longitude: 120.98425 },
      label: 'Library corner',
      createdAt: '2026-08-31T08:05:00.000Z',
    },
  ],
  lastPosition: null,
  lastError: null,
}

class FakeQueryBuilder {
  operation: 'select' | 'insert' | 'update' = 'select'
  payload: FakeRow | null = null
  filters: Array<{ column: string; value: unknown }> = []

  constructor(private readonly client: FakeSupabaseClient) {}

  select(_columns = '*') {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value })
    return this
  }

  order(_column: string, _options?: { ascending?: boolean }) {
    return this
  }

  then(
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) {
    return this.client.execute(this, false, true).then(onFulfilled, onRejected)
  }

  insert(payload: FakeRow) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: FakeRow) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  maybeSingle() {
    return this.client.execute(this, false)
  }

  single() {
    return this.client.execute(this, true)
  }
}

class FakeSupabaseClient {
  user: { id: string } | null = { id: 'real-user-1' }
  authError: FakeError | null = null
  selectError: FakeError | null = null
  insertError: FakeError | null = null
  updateError: FakeError | null = null
  rows: FakeRow[] = []
  insertedRows: FakeRow[] = []
  updatedCalls: Array<{ payload: FakeRow; filters: Array<{ column: string; value: unknown }> }> = []
  fromCalls = 0

  auth = {
    getUser: async () => ({ data: { user: this.user }, error: this.authError }),
  }

  from(table: string) {
    this.fromCalls += 1
    if (table !== CAPTURE_SESSIONS_TABLE) {
      throw new Error(`Unexpected table: ${table}`)
    }
    return new FakeQueryBuilder(this)
  }

  async execute(builder: FakeQueryBuilder, requireSingle: boolean, many = false) {
    if (builder.operation === 'select') {
      if (this.selectError) return { data: null, error: this.selectError }
      const matches = this.rows.filter((row) =>
        builder.filters.every((filter) => row[filter.column] === filter.value),
      )
      return { data: many || requireSingle ? (many ? matches : matches[0] ?? null) : matches[0] ?? null, error: null }
    }

    if (builder.operation === 'insert') {
      if (this.insertError) return { data: null, error: this.insertError }
      this.insertedRows.push(structuredClone(builder.payload ?? {}))
      const row: FakeRow = {
        ...builder.payload,
        owner_id: this.user?.id,
        created_at: '2026-08-31T09:00:00.000Z',
        updated_at: '2026-08-31T09:00:00.000Z',
      }
      this.rows.push(row)
      return { data: row, error: null }
    }

    if (this.updateError) return { data: null, error: this.updateError }
    const index = this.rows.findIndex((row) =>
      builder.filters.every((filter) => row[filter.column] === filter.value),
    )
    if (index < 0) return { data: null, error: null }

    const payload = builder.payload ?? {}
    this.updatedCalls.push({ payload: structuredClone(payload), filters: [...builder.filters] })
    this.rows[index] = {
      ...this.rows[index],
      ...payload,
      updated_at: '2026-08-31T09:00:00.000Z',
    }
    return { data: this.rows[index], error: null }
  }
}

function asClient(client: FakeSupabaseClient): SupabaseClient {
  return client as unknown as SupabaseClient
}

function rowForSession(overrides: FakeRow = {}): FakeRow {
  return {
    session_id: session.id,
    owner_id: 'real-user-1',
    campus_id: session.campusId,
    title: session.title,
    status: session.status,
    schema_version: session.schemaVersion,
    payload: structuredClone(session),
    content_hash: 'remote-hash',
    client_updated_at: session.updatedAt,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    ...overrides,
  }
}

describe('SupabaseCaptureRepository', () => {
  it('inserts an authenticated finished session with the exact payload and metadata', async () => {
    const client = new FakeSupabaseClient()
    const repository = createSupabaseCaptureRepository(asClient(client))

    const result = await repository.uploadSession(session)
    const inserted = client.insertedRows[0]

    expect(result.kind).toBe('uploaded')
    expect(inserted).toMatchObject({
      session_id: session.id,
      campus_id: session.campusId,
      title: session.title,
      status: session.status,
      schema_version: session.schemaVersion,
      client_updated_at: session.updatedAt,
    })
    expect(inserted).not.toHaveProperty('owner_id')
    expect(inserted?.payload).toEqual(session)
    expect((inserted?.payload as CaptureSession).rawSamples).toEqual(session.rawSamples)
    expect((inserted?.payload as CaptureSession).candidateRoute).toEqual(session.candidateRoute)
    expect(inserted?.content_hash).toBe(await hashCaptureSession(session))
  })

  it('rejects a finished session without a campus before any remote request', async () => {
    const client = new FakeSupabaseClient()
    const repository = createSupabaseCaptureRepository(asClient(client))
    const campusless = structuredClone(session)
    delete campusless.campusId

    await expect(repository.uploadSession(campusless)).rejects.toMatchObject({
      code: 'CAMPUS_REQUIRED',
      message: 'Choose a campus before syncing.',
    })
    expect(client.fromCalls).toBe(0)
  })

  it('returns unchanged when the remote hash equals the local hash', async () => {
    const client = new FakeSupabaseClient()
    client.rows = [rowForSession({ content_hash: await hashCaptureSession(session) })]
    const repository = createSupabaseCaptureRepository(asClient(client))

    const result = await repository.uploadSession(session, 'previous-hash')

    expect(result.kind).toBe('unchanged')
    expect(client.insertedRows).toHaveLength(0)
    expect(client.updatedCalls).toHaveLength(0)
  })

  it('returns conflict when the remote hash differs from expectedRemoteHash', async () => {
    const client = new FakeSupabaseClient()
    client.rows = [rowForSession({ content_hash: 'remote-hash' })]
    const repository = createSupabaseCaptureRepository(asClient(client))

    const result = await repository.uploadSession(session, 'known-local-hash')

    expect(result.kind).toBe('conflict')
    expect(client.updatedCalls).toHaveLength(0)
  })

  it('conditionally updates only the known remote version', async () => {
    const client = new FakeSupabaseClient()
    client.rows = [rowForSession({ content_hash: 'remote-hash' })]
    const repository = createSupabaseCaptureRepository(asClient(client))
    const changed = structuredClone(session)
    changed.title = 'North walkway survey, revised'

    const result = await repository.uploadSession(changed, 'remote-hash')

    expect(result.kind).toBe('uploaded')
    expect(client.updatedCalls).toHaveLength(1)
    expect(client.updatedCalls[0]?.filters).toEqual([
      { column: 'session_id', value: session.id },
      { column: 'content_hash', value: 'remote-hash' },
    ])
  })

  it('lists campus-filtered summaries with counts derived from each validated payload', async () => {
    const client = new FakeSupabaseClient()
    const otherSession = { ...structuredClone(session), id: 'capture-2', campusId: 'campus-2' }
    client.rows = [
      rowForSession(),
      rowForSession({
        session_id: otherSession.id,
        campus_id: otherSession.campusId,
        title: otherSession.title,
        payload: otherSession,
      }),
    ]
    const repository = createSupabaseCaptureRepository(asClient(client))

    const summaries = await repository.listSessions({ campusId: 'campus-1' })

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      sessionId: session.id,
      campusId: 'campus-1',
      rawSampleCount: 2,
      candidateNodeCount: 2,
      candidateEdgeCount: 1,
      markerCount: 1,
    })
  })

  it('returns a cloned full session so remote reads preserve raw, candidate, and marker data', async () => {
    const client = new FakeSupabaseClient()
    client.rows = [rowForSession()]
    const repository = createSupabaseCaptureRepository(asClient(client))

    const remote = await repository.getSession(session.id)

    expect(remote?.session).toEqual(session)
    expect(remote?.session.rawSamples).toEqual(session.rawSamples)
    expect(remote?.session.candidateRoute).toEqual(session.candidateRoute)
    expect(remote?.session.markers).toEqual(session.markers)

    if (remote) {
      remote.session.rawSamples[0]!.latitude = 0
      remote.session.markers[0]!.label = 'changed locally'
    }
    expect((client.rows[0]?.payload as CaptureSession).rawSamples[0]?.latitude).toBe(14.5995)
    expect((client.rows[0]?.payload as CaptureSession).markers[0]?.label).toBe('Library corner')
  })

  it('maps missing auth, network, and remote failures to provider-neutral codes', async () => {
    const missingAuthClient = new FakeSupabaseClient()
    missingAuthClient.user = null
    const missingAuthRepository = createSupabaseCaptureRepository(asClient(missingAuthClient))
    await expect(missingAuthRepository.uploadSession(session)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    })

    const networkClient = new FakeSupabaseClient()
    networkClient.selectError = { name: 'TypeError', message: 'Failed to fetch' }
    const networkRepository = createSupabaseCaptureRepository(asClient(networkClient))
    await expect(networkRepository.uploadSession(session)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    })

    const remoteClient = new FakeSupabaseClient()
    remoteClient.insertError = { status: 500, message: 'database unavailable' }
    const remoteRepository = createSupabaseCaptureRepository(asClient(remoteClient))
    await expect(remoteRepository.uploadSession(session)).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
    })
  })
})
