import { describe, expect, it, vi } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { CommandDispatcher, CommandRegistry, DocumentEventBus, DocumentStore, roadCreateHandler } from '@navi/editor'
import type { CaptureSession } from '@/features/capture/types'
import type { CaptureReviewSelection } from '@/features/capture-review/types'
import {
  CaptureImportAdapter,
  DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
  type CaptureImportContext,
  type CaptureImportCommandExecutor,
} from '../adapter'
import { createMemoryCaptureImportManifestStore } from '../manifest'

const session: CaptureSession = {
  schemaVersion: 1,
  id: 'capture-outdoor-1',
  title: 'Library footpath',
  status: 'finished',
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:05:00.000Z',
  startedAt: '2026-08-31T10:00:00.000Z',
  finishedAt: '2026-08-31T10:05:00.000Z',
  rawSamples: [
    { sequence: 0, timestamp: '2026-08-31T10:00:00.000Z', latitude: 11.8, longitude: 122.1, accuracy: 4, altitude: 12, altitudeAccuracy: 2, heading: 90, speed: 1 },
    { sequence: 1, timestamp: '2026-08-31T10:01:00.000Z', latitude: 11.8005, longitude: 122.1005, accuracy: 5, altitude: 12, altitudeAccuracy: 2, heading: 90, speed: 1 },
    { sequence: 2, timestamp: '2026-08-31T10:02:00.000Z', latitude: 11.801, longitude: 122.101, accuracy: 6, altitude: 12, altitudeAccuracy: 2, heading: 90, speed: 1 },
    { sequence: 3, timestamp: '2026-08-31T10:03:00.000Z', latitude: 11.8015, longitude: 122.1015, accuracy: 7, altitude: 12, altitudeAccuracy: 2, heading: 90, speed: 1 },
  ],
  candidateRoute: {
    points: [
      { latitude: 11.8, longitude: 122.1 },
      { latitude: 11.8005, longitude: 122.1005 },
      { latitude: 11.801, longitude: 122.101 },
      { latitude: 11.8015, longitude: 122.1015 },
    ],
    sourceSampleIndices: [0, 1, 2, 3],
    edgeCount: 3,
    derivedFromSampleCount: 4,
    derivedAt: '2026-08-31T10:05:00.000Z',
    algorithmVersion: 'capture-dp-v1',
  },
  markers: [
    {
      id: 'poi-library',
      type: 'poi',
      label: 'Library',
      position: { latitude: 11.8005, longitude: 122.1005 },
      createdAt: '2026-08-31T10:02:00.000Z',
    },
  ],
}

const context: CaptureImportContext = {
  authoritativeCampusId: 'campus-1',
  captureCampusId: 'campus-1',
  studioCampusId: 'campus-1',
  roadWidthMeters: DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
}

function selection(routeSegments: CaptureReviewSelection['routeSegments'] = {}): CaptureReviewSelection {
  return { routeSegments, markers: { 'poi-library': 'included' } }
}

function createExecutor(result = { success: true, results: [{ success: true, entityId: 'road-imported-1', data: { id: 'road-imported-1' } }] }): CaptureImportCommandExecutor & { executeBatch: ReturnType<typeof vi.fn> } {
  return { executeBatch: vi.fn(() => result) }
}

describe('CaptureImportAdapter outdoor pathway contract', () => {
  it('creates a canonical Road through the existing editor command dispatcher', async () => {
    const document: CampusDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: 'campus-1', name: 'Demo', description: '', lastModified: '', editorVersion: 'test' },
      buildings: [],
      roads: [],
      panoramas: [],
      qrCheckpoints: [],
    }
    const eventBus = new DocumentEventBus()
    const documentStore = new DocumentStore(document, eventBus)
    const registry = new CommandRegistry()
    registry.register(roadCreateHandler)
    const dispatcher = new CommandDispatcher(registry, document, eventBus)
    await dispatcher.init({
      document,
      get(id) {
        if (id === 'eventBus') return eventBus
        if (id === 'documentStore') return documentStore
        throw new Error(`Unexpected service: ${id}`)
      },
    } as never)
    const adapter = new CaptureImportAdapter({
      executor: dispatcher,
      manifestStore: createMemoryCaptureImportManifestStore(),
    })
    const rawBefore = structuredClone(session.rawSamples)

    const result = adapter.importOutdoorRoute(session, selection(), context)

    expect(result.status).toBe('imported')
    expect(document.roads).toHaveLength(1)
    expect(document.roads[0]).toMatchObject({
      name: 'Library footpath',
      type: 'pedestrian',
      width: DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
      polyline: { points: [{ lat: 11.8, lng: 122.1 }, { lat: 11.8005, lng: 122.1005 }, { lat: 11.801, lng: 122.101 }, { lat: 11.8015, lng: 122.1015 }] },
    })
    expect(session.rawSamples).toEqual(rawBefore)
  })

  it('plans a valid outdoor candidate as pedestrian Road command(s)', () => {
    const executor = createExecutor()
    const adapter = new CaptureImportAdapter({
      executor,
      manifestStore: createMemoryCaptureImportManifestStore(),
    })

    const plan = adapter.planOutdoorRoute(session, selection(), context)

    expect(plan.status).toBe('ready')
    expect(plan.commands).toHaveLength(1)
    expect(plan.commands[0].sourceSegmentIds).toEqual(['segment-0', 'segment-1', 'segment-2'])
    expect(plan.commands[0].command).toMatchObject({
      id: 'road.create',
      payload: {
        name: 'Library footpath',
        points: [
          { lat: 11.8, lng: 122.1 },
          { lat: 11.8005, lng: 122.1005 },
          { lat: 11.801, lng: 122.101 },
          { lat: 11.8015, lng: 122.1015 },
        ],
        type: 'pedestrian',
        width: DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
        surface: 'paved',
      },
    })
    expect(plan.commands[0].command.payload).not.toHaveProperty('buildingId')
    expect(plan.commands[0].command.payload).not.toHaveProperty('floor')
  })

  it('uses the reviewed candidate geometry exactly as supplied by Reviewer', () => {
    const executor = createExecutor()
    const adapter = new CaptureImportAdapter({
      executor,
      manifestStore: createMemoryCaptureImportManifestStore(),
    })
    const reviewed = structuredClone(session)
    reviewed.candidateRoute!.points[1] = { latitude: 11.80072, longitude: 122.10064 }
    const rawBefore = structuredClone(reviewed.rawSamples)

    const plan = adapter.planOutdoorRoute(reviewed, selection(), context)

    expect(plan.status).toBe('ready')
    expect(plan.commands[0].command.payload.points).toEqual([
      { lat: 11.8, lng: 122.1 },
      { lat: 11.80072, lng: 122.10064 },
      { lat: 11.801, lng: 122.101 },
      { lat: 11.8015, lng: 122.1015 },
    ])
    expect(reviewed.rawSamples).toEqual(rawBefore)
  })

  it('plans only the selected route segment and does not import markers', () => {
    const adapter = new CaptureImportAdapter({
      executor: createExecutor(),
      manifestStore: createMemoryCaptureImportManifestStore(),
    })

    const plan = adapter.planOutdoorRoute(session, selection({
      'segment-0': 'excluded',
      'segment-1': 'included',
      'segment-2': 'excluded',
    }), context)

    expect(plan.status).toBe('ready')
    expect(plan.commands).toHaveLength(1)
    expect(plan.commands[0].sourceSegmentIds).toEqual(['segment-1'])
    expect(plan.commands[0].command.payload.points).toEqual([
      { lat: 11.8005, lng: 122.1005 },
      { lat: 11.801, lng: 122.101 },
    ])
  })

  it('rejects an invalid candidate before dispatch and keeps raw samples unchanged', () => {
    const executor = createExecutor()
    const adapter = new CaptureImportAdapter({
      executor,
      manifestStore: createMemoryCaptureImportManifestStore(),
    })
    const invalid = structuredClone(session)
    invalid.candidateRoute!.sourceSampleIndices[1] = 99
    const rawBefore = structuredClone(invalid.rawSamples)

    const result = adapter.importOutdoorRoute(invalid, selection(), context)

    expect(result.status).toBe('blocked')
    expect(result.plan.commands).toHaveLength(0)
    expect(executor.executeBatch).not.toHaveBeenCalled()
    expect(invalid.rawSamples).toEqual(rawBefore)
  })

  it('rejects a campus mismatch before mutation', () => {
    const executor = createExecutor()
    const adapter = new CaptureImportAdapter({
      executor,
      manifestStore: createMemoryCaptureImportManifestStore(),
    })

    const result = adapter.importOutdoorRoute(session, selection(), {
      ...context,
      captureCampusId: 'campus-other',
    })

    expect(result.status).toBe('blocked')
    expect(result.plan.errors.join(' ')).toMatch(/campus/i)
    expect(executor.executeBatch).not.toHaveBeenCalled()
  })

  it('warns and does not silently duplicate a previously imported capture segment', () => {
    const executor = createExecutor()
    const manifestStore = createMemoryCaptureImportManifestStore()
    const adapter = new CaptureImportAdapter({ executor, manifestStore })

    const onlyFirstSegment = selection({
      'segment-0': 'included',
      'segment-1': 'excluded',
      'segment-2': 'excluded',
    })
    const first = adapter.importOutdoorRoute(session, onlyFirstSegment, context)
    const second = adapter.importOutdoorRoute(session, onlyFirstSegment, context)

    expect(first.status).toBe('imported')
    expect(second.status).toBe('duplicate')
    expect(second.plan.warnings.join(' ')).toMatch(/already imported/i)
    expect(executor.executeBatch).toHaveBeenCalledTimes(1)
    expect(manifestStore.read().imports).toHaveLength(1)
  })

  it('keeps compiled graph and publish outside the import boundary', () => {
    const executor = createExecutor()
    const compile = vi.fn()
    const publish = vi.fn()
    const adapter = new CaptureImportAdapter({
      executor,
      manifestStore: createMemoryCaptureImportManifestStore(),
    })

    const result = adapter.importOutdoorRoute(session, selection(), context)

    expect(result.status).toBe('imported')
    expect(compile).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(executor.executeBatch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'road.create' }),
    ]))
  })
})
