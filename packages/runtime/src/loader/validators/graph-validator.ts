import type { NavigationGraphFile } from '@navi/core'
import type { ArtifactValidator } from '../artifact-hydrator'
import { isValidRoadEdgeRouting } from '@navi/core'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const graphValidator: ArtifactValidator<NavigationGraphFile> = {
  artifactType: 'graph',
  supportedSchemaVersion: '1.0.0',
  validate(data: unknown): data is NavigationGraphFile {
    if (!isRecord(data)) return false
    if (typeof data.campusId !== 'string' || data.campusId.length === 0) return false
    if (!Array.isArray(data.nodes)) return false
    if (!Array.isArray(data.edges)) return false
    for (const edge of data.edges) {
      if (!isRecord(edge)) return false
      if (
        Object.prototype.hasOwnProperty.call(edge, 'routing') &&
        !isValidRoadEdgeRouting(edge.routing)
      ) return false
    }
    return true
  },
}
