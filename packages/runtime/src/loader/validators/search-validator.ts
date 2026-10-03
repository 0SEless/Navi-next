import type { SearchIndexFile } from '@navi/core'
import type { ArtifactValidator } from '../artifact-hydrator'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const searchValidator: ArtifactValidator<SearchIndexFile> = {
  artifactType: 'search',
  supportedSchemaVersion: '1.0.0',
  validate(data: unknown): data is SearchIndexFile {
    if (!isRecord(data)) return false
    if (!Array.isArray(data.entries)) return false
    return true
  },
}
