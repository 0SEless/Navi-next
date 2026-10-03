import type {
  NavigationGraphFile,
  SearchIndexFile,
  BuildingIndexFile,
  POIIndexFile,
} from '@navi/core'

export interface ArtifactBundle {
  readonly graph?: NavigationGraphFile
  readonly search?: SearchIndexFile
  readonly buildings?: BuildingIndexFile
  readonly poi?: POIIndexFile
}

export type ValidateResult = ValidateSuccess | ValidateFailure

export interface ValidateSuccess {
  readonly success: true
}

export interface ValidateFailure {
  readonly success: false
  readonly code: ValidateErrorCode
  readonly message: string
  readonly references: readonly InvalidReference[]
}

export type ValidateErrorCode = 'REFERENCE_MISSING_NODE'

export interface InvalidReference {
  readonly source: string
  readonly field: string
  readonly missingId: string
}

export class ReferenceValidator {
  validate(bundle: ArtifactBundle): ValidateResult {
    const graph = bundle.graph
    if (!graph) {
      return {
        success: false,
        code: 'REFERENCE_MISSING_NODE',
        message: 'Graph artifact is required for reference validation',
        references: [],
      }
    }

    const nodeIds = new Set(graph.nodes.map(n => n.id))
    const errors: InvalidReference[] = []

    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from)) {
        errors.push({ source: 'graph.edges', field: 'from', missingId: edge.from })
      }
      if (!nodeIds.has(edge.to)) {
        errors.push({ source: 'graph.edges', field: 'to', missingId: edge.to })
      }
    }

    if (bundle.search) {
      for (const entry of bundle.search.entries) {
        // P1-T11: entries with an empty nodeId are document-anchored
        // (e.g. building discovery entries — no graph node exists); only
        // graph-anchored entries participate in reference integrity.
        if (!entry.nodeId) continue
        if (!nodeIds.has(entry.nodeId)) {
          errors.push({ source: 'search.entries', field: 'nodeId', missingId: entry.nodeId })
        }
      }
    }

    if (bundle.buildings) {
      for (const building of bundle.buildings.buildings) {
        for (const entrance of building.entrances) {
          if (!nodeIds.has(entrance.nodeId)) {
            errors.push({ source: 'buildings.entrances', field: 'nodeId', missingId: entrance.nodeId })
          }
        }
      }
    }

    if (bundle.poi) {
      for (const point of bundle.poi.points) {
        if (!point.nodeId && point.source === 'authored') continue
        if (!nodeIds.has(point.nodeId ?? '')) {
          errors.push({ source: 'poi.points', field: 'nodeId', missingId: point.nodeId ?? '' })
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        code: 'REFERENCE_MISSING_NODE',
        message: `${errors.length} invalid reference(s) detected`,
        references: errors,
      }
    }

    return { success: true }
  }
}
