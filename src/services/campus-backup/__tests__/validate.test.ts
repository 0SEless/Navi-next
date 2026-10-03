import { describe, expect, it } from 'vitest'
import { createCampusBackup } from '../export'
import type { CampusBackupV1 } from '../types'
import { CAMPUS_BACKUP_FORMAT, CAMPUS_BACKUP_SCHEMA_VERSION } from '../types'
import { validateCampusBackup } from '../validate'
import {
  CAMPUS_ID,
  FIXED_EXPORTED_AT,
  SOURCE_REVISION,
  buildCampusFixture,
  buildCampusMapFixture,
} from './fixture'

const fixture = buildCampusFixture()

function makeBackup(): CampusBackupV1 {
  return createCampusBackup({
    campusId: CAMPUS_ID,
    revision: SOURCE_REVISION,
    graph: fixture.snapshot,
    campusMap: buildCampusMapFixture(),
    exportedAt: FIXED_EXPORTED_AT,
  })
}

function codes(issues: Array<{ code: string }>): string[] {
  return issues.map((issue) => issue.code)
}

describe('validateCampusBackup', () => {
  it('accepts a canonical v1 backup', () => {
    const result = validateCampusBackup(makeBackup())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((warning) => warning.code === 'count-mismatch')).toBe(true)
    expect(result.backup).not.toBeNull()
  })

  it('rejects non-objects, unknown formats and unsupported schema versions', () => {
    expect(codes(validateCampusBackup(null).errors)).toContain('not-an-object')
    expect(codes(validateCampusBackup('{}').errors)).toContain('not-an-object')

    const unknownFormat = validateCampusBackup({ ...makeBackup(), format: 'navi-campus-backup/v9' })
    expect(unknownFormat.valid).toBe(false)
    expect(codes(unknownFormat.errors)).toContain('unknown-format')

    const newer = validateCampusBackup({ ...makeBackup(), schemaVersion: 2 })
    expect(codes(newer.errors)).toContain('unsupported-schema-version')
    expect(newer.errors.find((issue) => issue.code === 'unsupported-schema-version')?.message).toMatch(/newer/i)

    const older = validateCampusBackup({ ...makeBackup(), schemaVersion: 0 })
    expect(codes(older.errors)).toContain('unsupported-schema-version')
    expect(older.errors.find((issue) => issue.code === 'unsupported-schema-version')?.message).toMatch(/older/i)

    const missing = validateCampusBackup({ ...makeBackup(), schemaVersion: undefined })
    expect(codes(missing.errors)).toContain('unsupported-schema-version')
  })

  it('rejects missing campus identity and campus/graph mismatch', () => {
    const missingId = validateCampusBackup({ ...makeBackup(), campusId: '' })
    expect(codes(missingId.errors)).toContain('missing-field')
    expect(missingId.errors.some((issue) => issue.path === 'campusId')).toBe(true)

    const mismatch = validateCampusBackup({ ...makeBackup(), campusId: 'another-campus' })
    expect(mismatch.valid).toBe(false)
    expect(codes(mismatch.errors)).toContain('campus-id-mismatch')
  })

  it('rejects missing or non-array graph sections', () => {
    const backup = makeBackup()
    const nonArrayNodes = validateCampusBackup({ ...backup, graph: { ...backup.graph, nodes: 'nope' } })
    expect(nonArrayNodes.valid).toBe(false)
    expect(
      nonArrayNodes.errors.some((issue) => issue.code === 'missing-field' && issue.path === 'graph.nodes'),
    ).toBe(true)

    const missingGraph = validateCampusBackup({ ...backup, graph: undefined })
    expect(missingGraph.valid).toBe(false)
    expect(missingGraph.errors.some((issue) => issue.path === 'graph')).toBe(true)

    const badTraces = validateCampusBackup({ ...backup, graph: { ...backup.graph, traces: 'nope' } })
    expect(badTraces.errors.some((issue) => issue.path === 'graph.traces')).toBe(true)
  })

  it('rejects duplicate stable ids', () => {
    const backup = makeBackup()

    const duplicateBuilding = structuredClone(backup)
    duplicateBuilding.graph.buildings.push(structuredClone(backup.graph.buildings[0]))
    const buildingResult = validateCampusBackup(duplicateBuilding)
    expect(buildingResult.valid).toBe(false)
    expect(buildingResult.errors.some((issue) => issue.code === 'duplicate-id')).toBe(true)

    const duplicateNode = structuredClone(backup)
    duplicateNode.graph.nodes.push(structuredClone(backup.graph.nodes[0]))
    expect(codes(validateCampusBackup(duplicateNode).errors)).toContain('duplicate-id')

    const duplicateEdge = structuredClone(backup)
    duplicateEdge.graph.edges.push(structuredClone(backup.graph.edges[0]))
    expect(codes(validateCampusBackup(duplicateEdge).errors)).toContain('duplicate-id')

    const duplicateFloor = structuredClone(backup)
    duplicateFloor.graph.buildings[0].floors.push(duplicateFloor.graph.buildings[0].floors[0])
    const floorResult = validateCampusBackup(duplicateFloor)
    expect(floorResult.valid).toBe(false)
    expect(floorResult.errors.some((issue) => issue.code === 'duplicate-id')).toBe(true)
  })

  it('rejects edges that reference missing nodes', () => {
    const backup = structuredClone(makeBackup())
    backup.graph.edges[0].to = 'node-that-does-not-exist'
    const result = validateCampusBackup(backup)
    expect(result.valid).toBe(false)
    const issue = result.errors.find((entry) => entry.code === 'dangling-edge')
    expect(issue).toBeDefined()
    expect(issue?.path).toBe('graph.edges[0].to')
  })

  it('rejects doors that reference missing rooms, buildings or floors', () => {
    const missingRoom = structuredClone(makeBackup())
    missingRoom.graph.doors![0].roomId = 'room-that-does-not-exist'
    const roomResult = validateCampusBackup(missingRoom)
    expect(roomResult.valid).toBe(false)
    expect(codes(roomResult.errors)).toContain('dangling-door-room')

    const missingBuilding = structuredClone(makeBackup())
    missingBuilding.graph.doors![0].buildingId = 'building-that-does-not-exist'
    expect(codes(validateCampusBackup(missingBuilding).errors)).toContain('dangling-door-building')

    const missingFloor = structuredClone(makeBackup())
    missingFloor.graph.doors![0].floor = 42
    expect(codes(validateCampusBackup(missingFloor).errors)).toContain('dangling-door-floor')
  })

  it('rejects invalid coordinates', () => {
    const backup = structuredClone(makeBackup())
    backup.graph.nodes[0].position.lat = Number.NaN
    const result = validateCampusBackup(backup)
    expect(result.valid).toBe(false)
    expect(codes(result.errors)).toContain('invalid-coordinate')
  })

  it('rejects route-network edges that reference missing route nodes', () => {
    const backup = structuredClone(makeBackup())
    const floorData = backup.graph.buildings[0].floorData ?? []
    const groundRecord = floorData.find((record) => record.level === 0)
    expect(groundRecord).toBeDefined()
    const routeNetwork = groundRecord?.routeNetwork as { edges: Array<{ to: string }> }
    routeNetwork.edges[0].to = 'route-node-that-does-not-exist'
    const result = validateCampusBackup(backup)
    expect(result.valid).toBe(false)
    expect(codes(result.errors)).toContain('dangling-route-edge')
  })

  it('warns about derived projection drift and unknown fields without rejecting', () => {
    const backup = structuredClone(makeBackup())
    backup.campusMap!.stats.nodes = 9999
    backup.graph.nodes[0].metadata = {
      ...(backup.graph.nodes[0].metadata ?? {}),
      traceId: 'trace-that-does-not-exist',
    }
    const withExtraField = { ...backup, futureField: { anything: true } }

    const result = validateCampusBackup(withExtraField)
    expect(result.valid).toBe(true)
    expect(codes(result.warnings)).toEqual(
      expect.arrayContaining(['count-mismatch', 'dangling-trace-reference', 'unknown-field']),
    )
  })

  it('does not mutate its input', () => {
    const backup = makeBackup()
    const before = JSON.stringify(backup)
    validateCampusBackup(backup)
    expect(JSON.stringify(backup)).toBe(before)
  })

  it('accepts a backup without the optional campus map', () => {
    const backup = createCampusBackup({
      campusId: CAMPUS_ID,
      revision: null,
      graph: fixture.snapshot,
      exportedAt: FIXED_EXPORTED_AT,
    })
    const result = validateCampusBackup(backup)
    expect(result.valid).toBe(true)
    expect(result.backup?.campusMap).toBeUndefined()
    expect(result.backup?.sourceRevision).toBeNull()
  })

  it('exports the expected format and schema constants', () => {
    expect(CAMPUS_BACKUP_FORMAT).toBe('navi-campus-backup/v1')
    expect(CAMPUS_BACKUP_SCHEMA_VERSION).toBe(1)
  })
})
