import type { PanoramaIndexFile } from '@navi/core'
import type { ArtifactValidator } from '../artifact-hydrator'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const panoramaValidator: ArtifactValidator<PanoramaIndexFile> = {
  artifactType: 'panorama',
  supportedSchemaVersion: '1.0.0',
  validate(data: unknown): data is PanoramaIndexFile {
    if (!isRecord(data)) return false
    if (!Array.isArray(data.panoramas)) return false
    return true
  },
}
