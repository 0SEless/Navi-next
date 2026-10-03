import { describe, expect, it } from 'vitest'
import {
  CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION,
  appendCaptureImportEntries,
  createEmptyCaptureImportManifest,
  createMemoryCaptureImportManifestStore,
  parseCaptureImportManifest,
  serializeCaptureImportManifest,
} from '../manifest'

describe('CaptureImportManifest sidecar', () => {
  it('round-trips a versioned source-to-road mapping outside CampusDocument', () => {
    const manifest = appendCaptureImportEntries(createEmptyCaptureImportManifest(), [{
      captureSessionId: 'capture-1',
      captureRouteId: 'candidate-route:capture-1:capture-dp-v1',
      captureSegmentId: 'segment-2',
      importBatchId: 'batch-1',
      canonicalRoadId: 'rd-1',
      campusId: 'campus-1',
      importedAt: '2026-08-31T10:10:00.000Z',
    }])

    expect(manifest.schemaVersion).toBe(CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION)
    expect(parseCaptureImportManifest(serializeCaptureImportManifest(manifest))).toEqual(manifest)
  })

  it('persists independently in its namespaced store', () => {
    const store = createMemoryCaptureImportManifestStore()
    const manifest = appendCaptureImportEntries(createEmptyCaptureImportManifest(), [{
      captureSessionId: 'capture-1',
      captureRouteId: 'route-1',
      captureSegmentId: 'segment-0',
      importBatchId: 'batch-1',
      canonicalRoadId: 'rd-1',
      campusId: 'campus-1',
      importedAt: '2026-08-31T10:10:00.000Z',
    }])

    store.write(manifest)

    expect(store.read()).toEqual(manifest)
    expect(store.key).toBe('navi-capture-import-manifest-v1')
  })
})
