import { describe, expect, it } from 'vitest'

import { CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION, type CaptureImportManifest } from '../../capture-import/manifest'
import { hasImportedCaptureSessionHere } from '../provenance'

const manifest: CaptureImportManifest = {
  schemaVersion: CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION,
  imports: [
    {
      captureSessionId: 'capture-1',
      captureRouteId: 'route-1',
      captureSegmentId: 'segment-1',
      importBatchId: 'batch-1',
      canonicalRoadId: 'road-1',
      campusId: 'campus-1',
      importedAt: '2026-08-31T09:00:00.000Z',
    },
  ],
}

describe('hasImportedCaptureSessionHere', () => {
  it('requires an exact capture session and campus match', () => {
    expect(hasImportedCaptureSessionHere(manifest, {
      captureSessionId: 'capture-1',
      campusId: 'campus-1',
    })).toBe(true)
    expect(hasImportedCaptureSessionHere(manifest, {
      captureSessionId: 'capture-1',
      campusId: 'campus-2',
    })).toBe(false)
    expect(hasImportedCaptureSessionHere(manifest, {
      captureSessionId: 'capture-2',
      campusId: 'campus-1',
    })).toBe(false)
  })

  it('does not infer imported status from an empty or different manifest entry', () => {
    expect(hasImportedCaptureSessionHere({ ...manifest, imports: [] }, {
      captureSessionId: 'capture-1',
      campusId: 'campus-1',
    })).toBe(false)
  })
})
