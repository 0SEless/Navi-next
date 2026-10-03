import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import {
  CommandDispatcher,
  CommandRegistry,
  DocumentEventBus,
  DocumentStore,
  HistoryStack,
  roadCreateHandler,
  roadDeleteHandler,
} from '@navi/editor'
import type { CaptureSession } from '@/features/capture/types'
import type { CaptureReviewSelection } from '@/features/capture-review/types'
import {
  CaptureImportAdapter,
  DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
  type CaptureImportCommand,
  type CaptureImportContext,
  type CaptureImportCommandExecutor,
} from '../adapter'
import { createMemoryCaptureImportManifestStore } from '../manifest'

function createDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'campus-1', name: 'Demo', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function createSession(): CaptureSession {
  const rawSamples = Array.from({ length: 7 }, (_, index) => ({
    sequence: index,
    timestamp: `2026-08-31T10:0${index}:00.000Z`,
    latitude: 11.8 + index * 0.0005,
    longitude: 122.1 + index * 0.0005,
    accuracy: 4,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: 1,
  }))

  return {
    schemaVersion: 1,
    id: 'capture-history-session',
    title: 'History test pathway',
    status: 'finished',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:06:00.000Z',
    startedAt: '2026-08-31T10:00:00.000Z',
    finishedAt: '2026-08-31T10:06:00.000Z',
    rawSamples,
    candidateRoute: {
      points: rawSamples.map((sample) => ({ latitude: sample.latitude, longitude: sample.longitude })),
      sourceSampleIndices: rawSamples.map((_, index) => index),
      edgeCount: rawSamples.length - 1,
      derivedFromSampleCount: rawSamples.length,
      derivedAt: '2026-08-31T10:06:00.000Z',
      algorithmVersion: 'capture-dp-v1',
    },
    markers: [],
  }
}

const context: CaptureImportContext = {
  authoritativeCampusId: 'campus-1',
  captureCampusId: 'campus-1',
  studioCampusId: 'campus-1',
  roadWidthMeters: DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
}

function selection(routeSegments: CaptureReviewSelection['routeSegments'] = {}): CaptureReviewSelection {
  return { routeSegments, markers: {} }
}

async function createHarness() {
  const document = createDocument()
  const eventBus = new DocumentEventBus()
  const documentStore = new DocumentStore(document, eventBus)
  const registry = new CommandRegistry()
  registry.register(roadCreateHandler)
  registry.register(roadDeleteHandler)
  const dispatcher = new CommandDispatcher(registry, document, eventBus)
  const history = new HistoryStack(dispatcher, document, registry, 200, documentStore)

  dispatcher.addPreHook(history)
  dispatcher.addPostHook(history)

  const serviceContext = {
    document,
    get(id: string) {
      if (id === 'eventBus') return eventBus
      if (id === 'documentStore') return documentStore
      if (id === 'dispatcher') return dispatcher
      throw new Error(`Unexpected service: ${id}`)
    },
  } as never
  await dispatcher.init(serviceContext)
  await history.init(serviceContext)

  return { document, documentStore, dispatcher, eventBus, history, registry }
}

function createAdapter(executor: CaptureImportCommandExecutor) {
  return new CaptureImportAdapter({
    executor,
    manifestStore: createMemoryCaptureImportManifestStore(),
  })
}

describe('Capture import history integration', () => {
  it('records a single-road import as one undoable edit and restores it with redo', async () => {
    const harness = await createHarness()
    const session = createSession()
    const adapter = createAdapter(harness.dispatcher)
    const before = structuredClone(harness.document)

    const result = adapter.importOutdoorRoute(session, selection({
      'segment-0': 'excluded',
      'segment-1': 'excluded',
      'segment-2': 'excluded',
      'segment-3': 'excluded',
      'segment-4': 'excluded',
      'segment-5': 'included',
    }), context)
    const after = structuredClone(harness.document)

    expect(result.status).toBe('imported')
    expect(harness.document.roads).toHaveLength(1)
    expect(harness.history.undoCount).toBe(1)
    expect(harness.history.undo()).toBe(true)
    expect(harness.document).toEqual(before)
    expect(harness.history.redo()).toBe(true)
    expect(harness.document).toEqual(after)
  })

  it('groups three selected segments into one history entry and redoes them exactly once', async () => {
    const harness = await createHarness()
    const session = createSession()
    const adapter = createAdapter(harness.dispatcher)
    let documentChanged = 0
    harness.eventBus.on('document.changed', () => { documentChanged += 1 })

    const rawBefore = structuredClone(session.rawSamples)
    const result = adapter.importOutdoorRoute(session, selection({
      'segment-0': 'included',
      'segment-1': 'excluded',
      'segment-2': 'included',
      'segment-3': 'excluded',
      'segment-4': 'included',
      'segment-5': 'excluded',
    }), context)
    const after = structuredClone(harness.document)

    expect(result.status).toBe('imported')
    expect(result.canonicalRoadIds).toHaveLength(3)
    expect(harness.document.roads).toHaveLength(3)
    expect(harness.history.undoCount).toBe(1)
    expect(documentChanged).toBe(1)

    expect(harness.history.undo()).toBe(true)
    expect(harness.document.roads).toHaveLength(0)
    expect(harness.history.undoCount).toBe(0)
    expect(harness.history.redoCount).toBe(1)
    expect(documentChanged).toBe(2)

    expect(harness.history.redo()).toBe(true)
    expect(harness.document).toEqual(after)
    expect(harness.document.roads.map((road) => road.id)).toEqual(result.canonicalRoadIds)
    expect(harness.history.redo()).toBe(false)
    expect(harness.document.roads).toHaveLength(3)
    expect(documentChanged).toBe(3)
    expect(session.rawSamples).toEqual(rawBefore)
  })

  it('leaves document and history unchanged when the import preview is cancelled', async () => {
    const harness = await createHarness()
    const adapter = createAdapter(harness.dispatcher)
    const before = structuredClone(harness.document)

    const plan = adapter.planOutdoorRoute(createSession(), selection(), context)

    expect(plan.status).toBe('ready')
    expect(harness.document).toEqual(before)
    expect(harness.history.undoCount).toBe(0)
    expect(harness.documentStore.version).toBe(0)
  })

  it('rejects a duplicate import without changing document or history', async () => {
    const harness = await createHarness()
    const session = createSession()
    const adapter = createAdapter(harness.dispatcher)
    const chosen = selection({
      'segment-0': 'included',
      'segment-1': 'excluded',
      'segment-2': 'excluded',
      'segment-3': 'excluded',
      'segment-4': 'excluded',
      'segment-5': 'excluded',
    })

    const first = adapter.importOutdoorRoute(session, chosen, context)
    const beforeDuplicate = structuredClone(harness.document)
    const versionBeforeDuplicate = harness.documentStore.version
    const second = adapter.importOutdoorRoute(session, chosen, context)

    expect(first.status).toBe('imported')
    expect(second.status).toBe('duplicate')
    expect(harness.document).toEqual(beforeDuplicate)
    expect(harness.documentStore.version).toBe(versionBeforeDuplicate)
    expect(harness.history.undoCount).toBe(1)
  })

  it('rolls back a failed batch without leaving a history entry', async () => {
    const harness = await createHarness()
    harness.registry.register({
      id: 'test.fail-after-mutation',
      execute(document: CampusDocument) {
        document.roads.push({
          id: 'failed-road',
          name: 'Failed',
          polyline: { points: [{ lat: 11.8, lng: 122.1 }, { lat: 11.801, lng: 122.101 }] },
          width: 3,
          surface: 'paved',
          type: 'pedestrian',
          displayMode: 'visible',
          metadata: {},
        })
        return { success: false, error: 'Injected command failure' }
      },
    })
    const failingExecutor: CaptureImportCommandExecutor = {
      executeBatch(commands: CaptureImportCommand[]) {
        return harness.dispatcher.executeBatch([
          ...commands,
          { id: 'test.fail-after-mutation', label: 'Fail', payload: {} },
        ])
      },
    }
    const adapter = createAdapter(failingExecutor)
    const before = structuredClone(harness.document)

    const result = adapter.importOutdoorRoute(createSession(), selection({
      'segment-0': 'excluded',
      'segment-1': 'excluded',
      'segment-2': 'excluded',
      'segment-3': 'excluded',
      'segment-4': 'excluded',
      'segment-5': 'included',
    }), context)

    expect(result.status).toBe('failed')
    expect(harness.document).toEqual(before)
    expect(harness.documentStore.version).toBe(0)
    expect(harness.history.undoCount).toBe(0)
  })
})
