import type { BuildingIndexFile } from '@navi/core'
import type { ArtifactValidator } from '../artifact-hydrator'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const buildingValidator: ArtifactValidator<BuildingIndexFile> = {
  artifactType: 'building',
  supportedSchemaVersion: '1.0.0',
  validate(data: unknown): data is BuildingIndexFile {
    if (!isRecord(data)) return false
    if (!Array.isArray(data.buildings)) return false
    return true
  },
}
