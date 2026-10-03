import { isValidRoadEdgeRouting } from '@navi/core'

export interface ArtifactDiagnostic {
  code: string
  message: string
  path?: string
  entityId?: string
}

export interface ArtifactValidationResult {
  valid: boolean
  errors: ArtifactDiagnostic[]
  warnings: ArtifactDiagnostic[]
}

export interface ArtifactValidationOptions {
  /**
   * New publish writes require the Phase 7 provenance fields. Read paths may
   * set this to false for a legacy-compatible boundary while retaining the
   * critical graph and reference checks.
   */
  requireProvenance?: boolean
  /**
   * Legacy read artifacts may predate graph campusId. When false, an available
   * graph campusId is still checked against metadata, but its absence is
   * tolerated. New publish writes keep the strict default.
   */
  requireGraphCampusId?: boolean
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseRevision(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function pushError(
  errors: ArtifactDiagnostic[],
  code: string,
  message: string,
  path?: string,
  entityId?: string,
): void {
  errors.push({ code, message, ...(path ? { path } : {}), ...(entityId ? { entityId } : {}) })
}

function pushWarning(
  warnings: ArtifactDiagnostic[],
  code: string,
  message: string,
  path?: string,
): void {
  warnings.push({ code, message, ...(path ? { path } : {}) })
}

function validateWorldPosition(
  value: unknown,
  path: string,
  code: string,
  message: string,
  errors: ArtifactDiagnostic[],
  entityId?: string,
): void {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.lat) ||
    !isFiniteNumber(value.lng)
  ) {
    pushError(errors, code, message, path, entityId)
  }
}

function collectBuildingReferences(value: unknown): {
  buildingIds: Set<string>
  floorsByBuilding: Map<string, Set<number> | null>
} {
  const buildingIds = new Set<string>()
  const floorsByBuilding = new Map<string, Set<number> | null>()
  if (!isRecord(value) || !Array.isArray(value.buildings)) {
    return { buildingIds, floorsByBuilding }
  }

  for (const building of value.buildings) {
    if (!isRecord(building) || !isNonEmptyString(building.id)) continue
    const id = building.id
    buildingIds.add(id)
    if (!hasOwn(building, 'floors')) {
      floorsByBuilding.set(id, null)
      continue
    }
    if (!Array.isArray(building.floors)) {
      floorsByBuilding.set(id, new Set())
      continue
    }
    const floors = new Set<number>()
    for (const floor of building.floors) {
      const level = isRecord(floor) ? floor.level : floor
      if (isFiniteNumber(level)) floors.add(level)
    }
    floorsByBuilding.set(id, floors)
  }

  return { buildingIds, floorsByBuilding }
}

function validatePlacement(
  entity: UnknownRecord,
  label: string,
  code: string,
  buildingIds: Set<string>,
  floorsByBuilding: Map<string, Set<number> | null>,
  errors: ArtifactDiagnostic[],
): void {
  const entityId = isNonEmptyString(entity.id) ? entity.id : undefined
  if (!isNonEmptyString(entity.id)) {
    pushError(errors, code, label + ' id must be a non-empty string', undefined, entityId)
  }

  if (hasOwn(entity, 'position')) {
    validateWorldPosition(
      entity.position,
      label + '.position',
      code,
      label + ' position must contain finite lat/lng coordinates',
      errors,
      entityId,
    )
  }

  let buildingId: string | undefined
  if (hasOwn(entity, 'buildingId')) {
    if (!isNonEmptyString(entity.buildingId) || !buildingIds.has(entity.buildingId)) {
      pushError(
        errors,
        code,
        label + ' buildingId must reference a known building',
        label + '.buildingId',
        entityId,
      )
    } else {
      buildingId = entity.buildingId
    }
  }

  if (hasOwn(entity, 'floor')) {
    if (!isFiniteNumber(entity.floor)) {
      pushError(
        errors,
        code,
        label + ' floor must be a finite number',
        label + '.floor',
        entityId,
      )
    } else if (buildingId) {
      const floors = floorsByBuilding.get(buildingId)
      if (floors && !floors.has(entity.floor)) {
        pushError(
          errors,
          code,
          label + ' floor must reference a floor on its building',
          label + '.floor',
          entityId,
        )
      }
    }
  }
}

function validateFiniteTree(
  value: unknown,
  path: string,
  code: string,
  errors: ArtifactDiagnostic[],
  seen = new WeakSet<object>(),
): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      pushError(errors, code, 'Artifact geometry contains a non-finite number', path)
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateFiniteTree(item, path + '[' + index + ']', code, errors, seen))
    return
  }

  for (const [key, child] of Object.entries(value)) {
    validateFiniteTree(child, path + '.' + key, code, errors, seen)
  }
}

function validateProvenance(
  root: UnknownRecord,
  graph: UnknownRecord,
  requireProvenance: boolean,
  requireGraphCampusId: boolean,
  errors: ArtifactDiagnostic[],
): void {
  const metadata = isRecord(root.metadata) ? root.metadata : null
  const graphCampusId = graph.campusId
  if (!isNonEmptyString(graphCampusId) && requireGraphCampusId) {
    pushError(
      errors,
      'ARTIFACT_CAMPUS_ID_MISMATCH',
      'NavigationGraph campusId must be a non-empty string',
      'graph.campusId',
    )
  }

  if (!metadata) {
    if (requireProvenance) {
      pushError(errors, 'ARTIFACT_MISSING_PROVENANCE', 'Artifact metadata is required for a new publication', 'metadata')
    }
    return
  }

  const metadataCampusId = metadata.campusId
  if (requireProvenance && !isNonEmptyString(metadataCampusId)) {
    pushError(
      errors,
      'ARTIFACT_MISSING_PROVENANCE',
      'Artifact metadata campusId is required for a new publication',
      'metadata.campusId',
    )
  }
  if (
    isNonEmptyString(metadataCampusId) &&
    isNonEmptyString(graphCampusId) &&
    metadataCampusId !== graphCampusId
  ) {
    pushError(
      errors,
      'ARTIFACT_CAMPUS_ID_MISMATCH',
      'Artifact metadata campusId must match NavigationGraph campusId',
      'metadata.campusId',
    )
  }

  if (requireProvenance && !isNonEmptyString(metadata.compilerVersion)) {
    pushError(
      errors,
      'ARTIFACT_MISSING_PROVENANCE',
      'Artifact metadata compilerVersion is required for a new publication',
      'metadata.compilerVersion',
    )
  }

  const revision = parseRevision(metadata.revision)
  const sourceDocumentVersion = parseRevision(metadata.sourceDocumentVersion)
  if (requireProvenance && revision === null) {
    pushError(
      errors,
      'ARTIFACT_INVALID_PROVENANCE',
      'Artifact metadata revision must be a non-negative integer',
      'metadata.revision',
    )
  }
  if (requireProvenance && sourceDocumentVersion === null) {
    pushError(
      errors,
      'ARTIFACT_INVALID_PROVENANCE',
      'Artifact metadata sourceDocumentVersion must be a non-negative integer',
      'metadata.sourceDocumentVersion',
    )
  }
  if (revision !== null && sourceDocumentVersion !== null && revision !== sourceDocumentVersion) {
    pushError(
      errors,
      'ARTIFACT_REVISION_MISMATCH',
      'Artifact metadata revision must match sourceDocumentVersion',
      'metadata',
    )
  }

  if (hasOwn(metadata, 'connectivitySemanticsVersion') && !isNonEmptyString(metadata.connectivitySemanticsVersion)) {
    pushError(
      errors,
      'ARTIFACT_INVALID_PROVENANCE',
      'connectivitySemanticsVersion must be a non-empty string when present',
      'metadata.connectivitySemanticsVersion',
    )
  }
}

export function validateNavigationArtifacts(
  artifacts: unknown,
  options: ArtifactValidationOptions = {},
): ArtifactValidationResult {
  const errors: ArtifactDiagnostic[] = []
  const warnings: ArtifactDiagnostic[] = []
  const requireProvenance = options.requireProvenance ?? true
  const requireGraphCampusId = options.requireGraphCampusId ?? true

  if (!isRecord(artifacts)) {
    pushError(errors, 'ARTIFACT_INVALID_PAYLOAD', 'NavigationArtifacts must be an object')
    return { valid: false, errors, warnings }
  }

  const graph = isRecord(artifacts.graph) ? artifacts.graph : null
  if (!graph) {
    pushError(errors, 'ARTIFACT_INVALID_GRAPH', 'NavigationArtifacts.graph must be an object', 'graph')
    return { valid: false, errors, warnings }
  }

  validateProvenance(artifacts, graph, requireProvenance, requireGraphCampusId, errors)

  const nodeIds = new Set<string>()
  if (!Array.isArray(graph.nodes)) {
    pushError(errors, 'ARTIFACT_INVALID_NODE_ARRAY', 'NavigationGraph.nodes must be an array', 'graph.nodes')
  } else {
    for (const [index, rawNode] of graph.nodes.entries()) {
      if (!isRecord(rawNode)) {
        pushError(errors, 'ARTIFACT_INVALID_NODE_ID', 'NavigationGraph node must be an object', 'graph.nodes[' + index + ']')
        continue
      }
      const nodeId = rawNode.id
      if (!isNonEmptyString(nodeId)) {
        pushError(errors, 'ARTIFACT_INVALID_NODE_ID', 'NavigationGraph node id must be non-empty', 'graph.nodes[' + index + '].id')
      } else if (nodeIds.has(nodeId)) {
        pushError(errors, 'ARTIFACT_DUPLICATE_NODE_ID', 'NavigationGraph node IDs must be unique', 'graph.nodes[' + index + '].id', nodeId)
      } else {
        nodeIds.add(nodeId)
      }
      validateWorldPosition(
        rawNode.position,
        'graph.nodes[' + index + '].position',
        'ARTIFACT_INVALID_NODE_POSITION',
        'NavigationGraph node position must contain finite lat/lng coordinates',
        errors,
        nodeId,
      )
    }
  }

  if (!Array.isArray(graph.edges)) {
    pushError(errors, 'ARTIFACT_INVALID_EDGE_ARRAY', 'NavigationGraph.edges must be an array', 'graph.edges')
  } else {
    const edgeIds = new Set<string>()
    for (const [index, rawEdge] of graph.edges.entries()) {
      if (!isRecord(rawEdge)) {
        pushError(errors, 'ARTIFACT_INVALID_EDGE', 'NavigationGraph edge must be an object', 'graph.edges[' + index + ']')
        continue
      }
      const edgeId = rawEdge.id
      if (!isNonEmptyString(edgeId)) {
        pushError(errors, 'ARTIFACT_INVALID_EDGE_ID', 'NavigationGraph edge id must be non-empty', 'graph.edges[' + index + '].id')
      } else if (edgeIds.has(edgeId)) {
        pushError(errors, 'ARTIFACT_DUPLICATE_EDGE_ID', 'NavigationGraph edge IDs must be unique', 'graph.edges[' + index + '].id', edgeId)
      } else {
        edgeIds.add(edgeId)
      }

      if (!isNonEmptyString(rawEdge.from) || !nodeIds.has(rawEdge.from)) {
        pushError(errors, 'ARTIFACT_DANGLING_EDGE', 'NavigationGraph edge source must reference an existing node', 'graph.edges[' + index + '].from', edgeId)
      }
      if (!isNonEmptyString(rawEdge.to) || !nodeIds.has(rawEdge.to)) {
        pushError(errors, 'ARTIFACT_DANGLING_EDGE', 'NavigationGraph edge target must reference an existing node', 'graph.edges[' + index + '].to', edgeId)
      }
      if (!isFiniteNumber(rawEdge.weight) || rawEdge.weight < 0) {
        pushError(errors, 'ARTIFACT_INVALID_EDGE_WEIGHT', 'NavigationGraph edge weight must be finite and non-negative', 'graph.edges[' + index + '].weight', edgeId)
      }
      if (!isFiniteNumber(rawEdge.distance) || rawEdge.distance < 0) {
        pushError(errors, 'ARTIFACT_INVALID_EDGE_WEIGHT', 'NavigationGraph edge distance must be finite and non-negative', 'graph.edges[' + index + '].distance', edgeId)
      }
      if (hasOwn(rawEdge, 'routing') && !isValidRoadEdgeRouting(rawEdge.routing)) {
        pushError(
          errors,
          'ARTIFACT_INVALID_EDGE_ROUTING',
          'NavigationGraph edge routing must be valid normalized Road metadata with source provenance',
          'graph.edges[' + index + '].routing',
          edgeId,
        )
      }
    }
  }

  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const graphEdges = Array.isArray(graph.edges) ? graph.edges : []
  if (graphNodes.length === 0 && graphEdges.length === 0) {
    pushWarning(warnings, 'ARTIFACT_EMPTY_GRAPH', 'NavigationGraph is empty; publish context must protect an existing non-empty publication', 'graph')
  }

  if (isRecord(graph.metadata) && isRecord(graph.metadata.boundingBox)) {
    for (const key of ['minLng', 'maxLng', 'minLat', 'maxLat']) {
      if (!isFiniteNumber(graph.metadata.boundingBox[key])) {
        pushError(errors, 'ARTIFACT_INVALID_GEOMETRY', 'NavigationGraph boundingBox values must be finite', 'graph.metadata.boundingBox.' + key)
      }
    }
  }

  const { buildingIds, floorsByBuilding } = collectBuildingReferences(artifacts.buildingIndex)
  const roomIds = new Set<string>()

  if (hasOwn(artifacts, 'components') && artifacts.components !== undefined) {
    if (!Array.isArray(artifacts.components)) {
      pushError(errors, 'ARTIFACT_INVALID_COMPONENT_REFERENCE', 'Artifact components must be an array', 'components')
    } else {
      for (const component of artifacts.components) {
        if (!isRecord(component)) {
          pushError(errors, 'ARTIFACT_INVALID_COMPONENT_REFERENCE', 'Artifact component must be an object', 'components')
          continue
        }
        validatePlacement(component, 'component', 'ARTIFACT_INVALID_COMPONENT_REFERENCE', buildingIds, floorsByBuilding, errors)
        if (
          isNonEmptyString(component.id) &&
          (component.type === 'room' || component.type === undefined)
        ) {
          roomIds.add(component.id)
        }
      }
    }
  }

  if (hasOwn(artifacts, 'doors') && artifacts.doors !== undefined) {
    if (!Array.isArray(artifacts.doors)) {
      pushError(errors, 'ARTIFACT_INVALID_DOOR_REFERENCE', 'Artifact doors must be an array', 'doors')
    } else {
      for (const door of artifacts.doors) {
        if (!isRecord(door)) {
          pushError(errors, 'ARTIFACT_INVALID_DOOR_REFERENCE', 'Artifact door must be an object', 'doors')
          continue
        }
        validatePlacement(door, 'door', 'ARTIFACT_INVALID_DOOR_REFERENCE', buildingIds, floorsByBuilding, errors)
        if (hasOwn(door, 'roomId')) {
          if (!isNonEmptyString(door.roomId) || !roomIds.has(door.roomId)) {
            pushError(
              errors,
              'ARTIFACT_INVALID_DOOR_REFERENCE',
              'Door roomId must reference an emitted room component when present',
              'door.roomId',
              isNonEmptyString(door.id) ? door.id : undefined,
            )
          }
        }
      }
    }
  }

  for (const [key, code] of [
    ['floorGeometry', 'ARTIFACT_INVALID_GEOMETRY'],
    ['panoramaIndex', 'ARTIFACT_INVALID_GEOMETRY'],
    ['qrIndex', 'ARTIFACT_INVALID_GEOMETRY'],
  ] as const) {
    if (hasOwn(artifacts, key) && artifacts[key] !== null && artifacts[key] !== undefined) {
      validateFiniteTree(artifacts[key], key, code, errors)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
