import { CAMPUS_BACKUP_FORMAT, CAMPUS_BACKUP_SCHEMA_VERSION } from './types'
import type {
  CampusBackupIssue,
  CampusBackupIssueCode,
  CampusBackupValidationResult,
  CampusBackupV1,
} from './types'

type JsonRecord = Record<string, unknown>
type AddIssue = (code: CampusBackupIssueCode, path: string, message: string) => void

const KNOWN_ENVELOPE_KEYS = new Set([
  'format',
  'schemaVersion',
  'exportedAt',
  'campusId',
  'sourceRevision',
  'graph',
  'campusMap',
])

const KNOWN_GRAPH_KEYS = new Set([
  'id',
  'campusId',
  'version',
  'updatedAt',
  'buildings',
  'components',
  'nodes',
  'edges',
  'traces',
  'areas',
  'pois',
  'boundary',
  'doors',
  'separatedCrossings',
  'connectivitySemanticsVersion',
])

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isLatLngLike(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isFiniteNumber(value.lat) || !isFiniteNumber(value.lng)) return false
  return value.elevation === undefined || isFiniteNumber(value.elevation)
}

function describe(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

function asRecordArray(
  value: unknown,
  path: string,
  addIssue: AddIssue,
  code: CampusBackupIssueCode = 'missing-field',
): JsonRecord[] | null {
  if (!Array.isArray(value)) {
    addIssue(code, path, `${path} must be an array`)
    return null
  }
  const records: JsonRecord[] = []
  value.forEach((entry, index) => {
    if (isRecord(entry)) {
      records.push(entry)
    } else {
      addIssue('invalid-field', `${path}[${index}]`, `${path} entries must be objects`)
    }
  })
  return records
}

function checkDuplicateIds(
  items: JsonRecord[],
  basePath: string,
  label: string,
  idOf: (item: JsonRecord, index: number) => unknown,
  addIssue: AddIssue,
): Set<string> {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const rawId = idOf(item, index)
    if (!isNonEmptyString(rawId)) {
      addIssue('invalid-field', `${basePath}[${index}].id`, `${label} at ${basePath}[${index}] must have a non-empty string id`)
      return
    }
    if (seen.has(rawId)) {
      addIssue('duplicate-id', `${basePath}[${index}].id`, `Duplicate ${label} id ${describe(rawId)}`)
      return
    }
    seen.add(rawId)
  })
  return seen
}

function validateRouteNetwork(value: unknown, path: string, addIssue: AddIssue): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    addIssue('invalid-field', path, `${path} must be an object`)
    return
  }
  const rawNodes = value.nodes
  const rawEdges = value.edges
  if (!Array.isArray(rawNodes)) {
    addIssue('invalid-field', `${path}.nodes`, `${path}.nodes must be an array`)
  }
  if (!Array.isArray(rawEdges)) {
    addIssue('invalid-field', `${path}.edges`, `${path}.edges must be an array`)
  }

  const routeNodeIds = new Set<string>()
  if (Array.isArray(rawNodes)) {
    rawNodes.forEach((node, index) => {
      if (!isRecord(node) || !isNonEmptyString(node.id)) {
        addIssue('invalid-field', `${path}.nodes[${index}].id`, `${path}.nodes[${index}] must have a non-empty string id`)
        return
      }
      if (routeNodeIds.has(node.id)) {
        addIssue('duplicate-id', `${path}.nodes[${index}].id`, `Duplicate route node id ${describe(node.id)}`)
        return
      }
      routeNodeIds.add(node.id)
    })
  }

  if (Array.isArray(rawEdges)) {
    const edgeIds = new Set<string>()
    rawEdges.forEach((edge, index) => {
      if (!isRecord(edge)) {
        addIssue('invalid-field', `${path}.edges[${index}]`, `${path}.edges[${index}] must be an object`)
        return
      }
      if (!isNonEmptyString(edge.id)) {
        addIssue('invalid-field', `${path}.edges[${index}].id`, `${path}.edges[${index}] must have a non-empty string id`)
      } else if (edgeIds.has(edge.id)) {
        addIssue('duplicate-id', `${path}.edges[${index}].id`, `Duplicate route edge id ${describe(edge.id)}`)
      } else {
        edgeIds.add(edge.id)
      }

      for (const endpoint of ['from', 'to'] as const) {
        const target = edge[endpoint]
        if (!isNonEmptyString(target)) {
          addIssue('invalid-field', `${path}.edges[${index}].${endpoint}`, `${path}.edges[${index}].${endpoint} must be a non-empty string`)
        } else if (Array.isArray(rawNodes) && !routeNodeIds.has(target)) {
          addIssue(
            'dangling-route-edge',
            `${path}.edges[${index}].${endpoint}`,
            `Route edge references missing route node ${describe(target)}`,
          )
        }
      }
    })
  }
}

/**
 * Structural + semantic validation of an untrusted campus backup payload.
 *
 * Read-only: the input is never cloned or mutated. Errors reject the payload;
 * warnings describe derivable-but-inconsistent projections (campus map stats,
 * dangling derived references) and unknown forward-compatible fields.
 */
export function validateCampusBackup(input: unknown): CampusBackupValidationResult {
  const errors: CampusBackupIssue[] = []
  const warnings: CampusBackupIssue[] = []
  const addError: AddIssue = (code, path, message) => {
    errors.push({ severity: 'error', code, path, message })
  }
  const addWarning: AddIssue = (code, path, message) => {
    warnings.push({ severity: 'warning', code, path, message })
  }

  if (!isRecord(input)) {
    addError('not-an-object', '', 'Campus backup must be a JSON object')
    return { valid: false, errors, warnings, backup: null }
  }

  if (input.format !== CAMPUS_BACKUP_FORMAT) {
    addError(
      'unknown-format',
      'format',
      `Expected backup format ${describe(CAMPUS_BACKUP_FORMAT)}, received ${describe(input.format)}`,
    )
  }

  const schemaVersion = input.schemaVersion
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    addError('unsupported-schema-version', 'schemaVersion', 'schemaVersion must be an integer')
  } else if (schemaVersion > CAMPUS_BACKUP_SCHEMA_VERSION) {
    addError(
      'unsupported-schema-version',
      'schemaVersion',
      `Backup schema version ${schemaVersion} is newer than supported version ${CAMPUS_BACKUP_SCHEMA_VERSION}; refusing to import`,
    )
  } else if (schemaVersion < CAMPUS_BACKUP_SCHEMA_VERSION) {
    addError(
      'unsupported-schema-version',
      'schemaVersion',
      `Backup schema version ${schemaVersion} is older than supported version ${CAMPUS_BACKUP_SCHEMA_VERSION}; refusing to import`,
    )
  }

  if (!isNonEmptyString(input.campusId)) {
    addError('missing-field', 'campusId', 'campusId must be a non-empty string')
  }
  if (typeof input.exportedAt !== 'string') {
    addError('missing-field', 'exportedAt', 'exportedAt must be an ISO timestamp string')
  } else if (Number.isNaN(Date.parse(input.exportedAt))) {
    addWarning('invalid-field', 'exportedAt', 'exportedAt is not a parseable ISO timestamp')
  }
  if (input.sourceRevision === undefined) {
    addWarning('missing-field', 'sourceRevision', 'sourceRevision is missing; treated as null')
  } else if (input.sourceRevision !== null && typeof input.sourceRevision !== 'string') {
    addError('invalid-field', 'sourceRevision', 'sourceRevision must be a string or null')
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_ENVELOPE_KEYS.has(key)) {
      addWarning('unknown-field', key, `Unknown envelope field ${describe(key)} is preserved but not interpreted`)
    }
  }

  const graph = input.graph
  if (!isRecord(graph)) {
    addError('missing-field', 'graph', 'graph must be a GraphSnapshot object')
    return { valid: false, errors, warnings, backup: null }
  }

  for (const key of Object.keys(graph)) {
    if (!KNOWN_GRAPH_KEYS.has(key)) {
      addWarning('unknown-field', `graph.${key}`, `Unknown graph field ${describe(key)} is preserved but not interpreted`)
    }
  }

  if (typeof graph.campusId !== 'string' || graph.campusId.trim().length === 0) {
    addError('missing-field', 'graph.campusId', 'graph.campusId must be a non-empty string')
  } else if (isNonEmptyString(input.campusId) && input.campusId !== graph.campusId) {
    addError(
      'campus-id-mismatch',
      'graph.campusId',
      `graph.campusId ${describe(graph.campusId)} does not match envelope campusId ${describe(input.campusId)}`,
    )
  }

  const buildings = asRecordArray(graph.buildings, 'graph.buildings', addError)
  const components = asRecordArray(graph.components, 'graph.components', addError)
  const nodes = asRecordArray(graph.nodes, 'graph.nodes', addError)
  const edges = asRecordArray(graph.edges, 'graph.edges', addError)
  const traces = asRecordArray(graph.traces, 'graph.traces', addError, 'invalid-field')
  const areas = asRecordArray(graph.areas, 'graph.areas', addError, 'invalid-field')
  const pois = asRecordArray(graph.pois, 'graph.pois', addError, 'invalid-field')
  const doors = asRecordArray(graph.doors, 'graph.doors', addError, 'invalid-field')
  const separatedCrossings = asRecordArray(graph.separatedCrossings, 'graph.separatedCrossings', addError, 'invalid-field')

  const buildingIds = new Set<string>()
  if (buildings) {
    checkDuplicateIds(buildings, 'graph.buildings', 'building', (building) => building.id, addError).forEach((id) =>
      buildingIds.add(id),
    )
    buildings.forEach((building, index) => {
      const path = `graph.buildings[${index}]`
      if (!Array.isArray(building.floors)) {
        addError('missing-field', `${path}.floors`, `${path}.floors must be an array of floor levels`)
      } else {
        const seenLevels = new Set<number>()
        building.floors.forEach((level, levelIndex) => {
          if (!isFiniteNumber(level)) {
            addError('invalid-field', `${path}.floors[${levelIndex}]`, 'floor level must be a finite number')
            return
          }
          if (seenLevels.has(level)) {
            addError('duplicate-id', `${path}.floors[${levelIndex}]`, `Duplicate floor level ${level} on building ${describe(building.id)}`)
            return
          }
          seenLevels.add(level)
        })
      }

      if (building.footprint !== undefined) {
        if (!Array.isArray(building.footprint)) {
          addError('invalid-field', `${path}.footprint`, `${path}.footprint must be an array of coordinates`)
        } else {
          building.footprint.forEach((point, pointIndex) => {
            if (!isLatLngLike(point)) {
              addError('invalid-coordinate', `${path}.footprint[${pointIndex}]`, 'footprint point must carry finite lat/lng')
            }
          })
        }
      }

      if (building.floorData !== undefined) {
        if (!Array.isArray(building.floorData)) {
          addError('invalid-field', `${path}.floorData`, `${path}.floorData must be an array`)
        } else {
          building.floorData.forEach((record, recordIndex) => {
            if (!isRecord(record)) {
              addError('invalid-field', `${path}.floorData[${recordIndex}]`, `${path}.floorData[${recordIndex}] must be an object`)
              return
            }
            validateRouteNetwork(record.routeNetwork, `${path}.floorData[${recordIndex}].routeNetwork`, addError)
          })
        }
      }
    })
  }

  const componentIds = new Set<string>()
  if (components) {
    checkDuplicateIds(components, 'graph.components', 'component', (component) => component.id, addError).forEach((id) =>
      componentIds.add(id),
    )
    components.forEach((component, index) => {
      const path = `graph.components[${index}]`
      if (!isNonEmptyString(component.type)) {
        addError('invalid-field', `${path}.type`, `${path}.type must be a non-empty string`)
      }
      if (!isLatLngLike(component.position)) {
        addError('invalid-coordinate', `${path}.position`, `${path}.position must carry finite lat/lng`)
      }
      if (buildings !== null && buildingIds.size > 0 && !buildingIds.has(String(component.buildingId))) {
        addError(
          'dangling-component-building',
          `${path}.buildingId`,
          `Component buildingId ${describe(component.buildingId)} does not match any building`,
        )
      }
    })
  }

  const nodeIds = new Set<string>()
  if (nodes) {
    checkDuplicateIds(nodes, 'graph.nodes', 'node', (node) => node.id, addError).forEach((id) => nodeIds.add(id))
    nodes.forEach((node, index) => {
      const path = `graph.nodes[${index}]`
      if (!isNonEmptyString(node.type)) {
        addError('invalid-field', `${path}.type`, `${path}.type must be a non-empty string`)
      }
      if (!isLatLngLike(node.position)) {
        addError('invalid-coordinate', `${path}.position`, `${path}.position must carry finite lat/lng`)
      }
    })
  }

  if (edges) {
    checkDuplicateIds(edges, 'graph.edges', 'edge', (edge) => edge.id, addError)
    edges.forEach((edge, index) => {
      const path = `graph.edges[${index}]`
      for (const endpoint of ['from', 'to'] as const) {
        const target = edge[endpoint]
        if (!isNonEmptyString(target)) {
          addError('invalid-field', `${path}.${endpoint}`, `${path}.${endpoint} must be a non-empty string`)
        } else if (nodes !== null && !nodeIds.has(target)) {
          addError('dangling-edge', `${path}.${endpoint}`, `Edge references missing node ${describe(target)}`)
        }
      }
      if (!isFiniteNumber(edge.distance) || edge.distance < 0) {
        addError('invalid-field', `${path}.distance`, `${path}.distance must be a finite non-negative number`)
      }
    })
  }

  const traceIds = new Set<string>()
  if (traces) {
    checkDuplicateIds(traces, 'graph.traces', 'trace', (trace) => trace.id, addError).forEach((id) => traceIds.add(id))
    traces.forEach((trace, index) => {
      const path = `graph.traces[${index}]`
      if (!Array.isArray(trace.points)) {
        addError('invalid-trace', `${path}.points`, `${path}.points must be an array of coordinates`)
        return
      }
      trace.points.forEach((point, pointIndex) => {
        if (!isLatLngLike(point)) {
          addError('invalid-coordinate', `${path}.points[${pointIndex}]`, 'trace point must carry finite lat/lng')
        }
      })
      if (trace.points.length < 2) {
        addWarning('invalid-trace', `${path}.points`, `${path} has fewer than two points`)
      }
    })
  }

  if (areas) {
    checkDuplicateIds(areas, 'graph.areas', 'area', (area) => area.id, addError)
    areas.forEach((area, index) => {
      const path = `graph.areas[${index}]`
      if (!Array.isArray(area.points)) {
        addError('invalid-field', `${path}.points`, `${path}.points must be an array of coordinates`)
        return
      }
      area.points.forEach((point, pointIndex) => {
        if (!isLatLngLike(point)) {
          addError('invalid-coordinate', `${path}.points[${pointIndex}]`, 'area point must carry finite lat/lng')
        }
      })
    })
  }

  if (pois) {
    checkDuplicateIds(pois, 'graph.pois', 'POI', (poi) => poi.id, addError)
    pois.forEach((poi, index) => {
      const path = `graph.pois[${index}]`
      if (!isRecord(poi.geometry) && !isRecord(poi.position)) {
        addError('invalid-field', `${path}.geometry`, `${path} must carry geometry or position`)
      }
    })
  }

  if (doors) {
    const roomComponentIds = new Set(
      (components ?? [])
        .filter((component) => component.type === 'room' && isNonEmptyString(component.id))
        .map((component) => component.id as string),
    )
    checkDuplicateIds(doors, 'graph.doors', 'door', (door) => door.id, addError)
    doors.forEach((door, index) => {
      const path = `graph.doors[${index}]`
      if (!isLatLngLike(door.position)) {
        addError('invalid-coordinate', `${path}.position`, `${path}.position must carry finite lat/lng`)
      }
      if (door.roomId !== undefined && components !== null) {
        if (!isNonEmptyString(door.roomId) || !roomComponentIds.has(door.roomId)) {
          addError('dangling-door-room', `${path}.roomId`, `Door references missing room ${describe(door.roomId)}`)
        }
      }
      if (door.buildingId !== undefined && buildings !== null) {
        if (!isNonEmptyString(door.buildingId) || !buildingIds.has(door.buildingId)) {
          addError('dangling-door-building', `${path}.buildingId`, `Door references missing building ${describe(door.buildingId)}`)
        }
      }
      if (door.floor !== undefined && isNonEmptyString(door.buildingId) && buildings !== null) {
        const building = buildings.find((candidate) => candidate.id === door.buildingId)
        if (building && Array.isArray(building.floors) && isFiniteNumber(door.floor)) {
          if (!building.floors.some((level) => level === door.floor)) {
            addError('dangling-door-floor', `${path}.floor`, `Door floor ${door.floor} is not a floor of building ${describe(door.buildingId)}`)
          }
        }
      }
    })
  }

  if (separatedCrossings) {
    checkDuplicateIds(separatedCrossings, 'graph.separatedCrossings', 'separated crossing', (crossing) => crossing.id, addError)
    separatedCrossings.forEach((crossing, index) => {
      const path = `graph.separatedCrossings[${index}]`
      const roadIds = crossing.roadIds
      if (!Array.isArray(roadIds) || roadIds.length !== 2 || !roadIds.every(isNonEmptyString)) {
        addError('invalid-field', `${path}.roadIds`, `${path}.roadIds must contain exactly two road ids`)
      } else if (traces !== null) {
        for (const roadId of roadIds) {
          if (!traceIds.has(roadId)) {
            addWarning('dangling-trace-reference', `${path}.roadIds`, `Separated crossing references unknown road ${describe(roadId)}`)
          }
        }
      }
      if (!isLatLngLike(crossing.position)) {
        addError('invalid-coordinate', `${path}.position`, `${path}.position must carry finite lat/lng`)
      }
    })
  }

  if (nodes && traces !== null) {
    nodes.forEach((node, index) => {
      const metadata = node.metadata
      if (!isRecord(metadata)) return
      const refs: string[] = []
      if (typeof metadata.traceId === 'string') refs.push(metadata.traceId)
      if (Array.isArray(metadata.traceIds)) {
        refs.push(...metadata.traceIds.filter(isNonEmptyString))
      }
      for (const ref of refs) {
        if (!traceIds.has(ref)) {
          addWarning('dangling-trace-reference', `graph.nodes[${index}].metadata`, `Node references unknown trace ${describe(ref)}`)
        }
      }
    })
  }

  const campusMap = input.campusMap
  if (campusMap !== undefined) {
    if (!isRecord(campusMap)) {
      addError('invalid-field', 'campusMap', 'campusMap must be an object')
    } else {
      if (isNonEmptyString(campusMap.id) && isNonEmptyString(input.campusId) && campusMap.id !== input.campusId) {
        addWarning(
          'campus-id-mismatch',
          'campusMap.id',
          `campusMap.id ${describe(campusMap.id)} does not match backup campusId ${describe(input.campusId)}`,
        )
      }
      if (campusMap.boundary !== undefined) {
        if (!Array.isArray(campusMap.boundary)) {
          addError('invalid-field', 'campusMap.boundary', 'campusMap.boundary must be an array of coordinates')
        } else {
          campusMap.boundary.forEach((point, index) => {
            if (!isLatLngLike(point)) {
              addError('invalid-coordinate', `campusMap.boundary[${index}]`, 'boundary point must carry finite lat/lng')
            }
          })
        }
      }
      if (campusMap.center !== undefined && !isLatLngLike(campusMap.center)) {
        addError('invalid-coordinate', 'campusMap.center', 'campusMap.center must carry finite lat/lng')
      }
      if (campusMap.stats !== undefined) {
        if (!isRecord(campusMap.stats)) {
          addError('invalid-field', 'campusMap.stats', 'campusMap.stats must be an object')
        } else {
          const stats = campusMap.stats
          if (buildings !== null && isFiniteNumber(stats.buildings) && stats.buildings !== buildings.length) {
            addWarning(
              'count-mismatch',
              'campusMap.stats.buildings',
              `campusMap.stats.buildings=${stats.buildings} does not match graph buildings=${buildings.length}`,
            )
          }
          if (nodes !== null && isFiniteNumber(stats.nodes) && stats.nodes !== nodes.length) {
            addWarning(
              'count-mismatch',
              'campusMap.stats.nodes',
              `campusMap.stats.nodes=${stats.nodes} does not match graph nodes=${nodes.length}`,
            )
          }
          if (edges !== null && isFiniteNumber(stats.edges) && stats.edges !== edges.length) {
            addWarning(
              'count-mismatch',
              'campusMap.stats.edges',
              `campusMap.stats.edges=${stats.edges} does not match graph edges=${edges.length}`,
            )
          }
        }
      }
      if (campusMap.landmarkTypes !== undefined) {
        const landmarkTypes = asRecordArray(campusMap.landmarkTypes, 'campusMap.landmarkTypes', addError, 'invalid-field')
        if (landmarkTypes) {
          checkDuplicateIds(landmarkTypes, 'campusMap.landmarkTypes', 'landmark type', (type) => type.id, addError)
        }
      }
      if (campusMap.landmarkInstances !== undefined) {
        const landmarkInstances = asRecordArray(campusMap.landmarkInstances, 'campusMap.landmarkInstances', addError, 'invalid-field')
        if (landmarkInstances) {
          checkDuplicateIds(landmarkInstances, 'campusMap.landmarkInstances', 'landmark instance', (instance) => instance.id, addError)
        }
      }
    }
  }

  if (buildings !== null && nodes !== null && buildings.length === 0 && nodes.length === 0) {
    addWarning('empty-graph', 'graph', 'Backup contains no buildings and no nodes')
  }

  const valid = errors.length === 0
  return {
    valid,
    errors,
    warnings,
    backup: valid ? (input as unknown as CampusBackupV1) : null,
  }
}
