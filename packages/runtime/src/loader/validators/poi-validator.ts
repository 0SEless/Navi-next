import type { POIIndexFile } from '@navi/core'
import type { ArtifactValidator } from '../artifact-hydrator'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const poiValidator: ArtifactValidator<POIIndexFile> = {
  artifactType: 'poi',
  supportedSchemaVersion: '1.0.0',
  validate(data: unknown): data is POIIndexFile {
    if (!isRecord(data)) return false
    if (!Array.isArray(data.points)) return false
    return true
  },
}
