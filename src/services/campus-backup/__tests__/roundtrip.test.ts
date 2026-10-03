import { describe, expect, it, vi } from 'vitest'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../../../../packages/editor/src/graph-adapter'
import { createCampusBackup } from '../export'
import { CampusBackupImportError, importCampusBackup } from '../import'
import { CAMPUS_BACKUP_FORMAT, CAMPUS_BACKUP_SCHEMA_VERSION } from '../types'
import { validateCampusBackup } from '../validate'
import {
  BUILDING_ID,
  CAMPUS_ID,
  FIXED_EXPORTED_AT,
  SOURCE_REVISION,
  buildCampusFixture,
  buildCampusMapFixture,
  createTransformerForDocument,
} from './fixture'
import {
  canonicalize,
  canonicalGraphSnapshot,
  expectPointsClose,
  normalizeGeneratedGraphIds,
} from './helpers'

const fixture = buildCampusFixture()

function makeBackup() {
  return createCampusBackup({
    campusId: CAMPUS_ID,
    revision: SOURCE_REVISION,
    graph: fixture.snapshot,
    campusMap: buildCampusMapFixture(),
    exportedAt: FIXED_EXPORTED_AT,
  })
}

describe('campus backup round trip', () => {
  it('creates a deterministic v1 envelope that preserves stable ids and isolates references', () => {
    const backup = makeBackup()
    expect(backup.format).toBe(CAMPUS_BACKUP_FORMAT)
    expect(backup.schemaVersion).toBe(CAMPUS_BACKUP_SCHEMA_VERSION)
    expect(backup.campusId).toBe(CAMPUS_ID)
    expect(backup.sourceRevision).toBe(SOURCE_REVISION)
    expect(backup.exportedAt).toBe(FIXED_EXPORTED_AT)
    expect(backup.graph.buildings.map((building) => building.id)).toEqual(
      fixture.snapshot.buildings.map((building) => building.id),
    )
    expect(backup.graph.nodes.map((node) => node.id)).toEqual(fixture.snapshot.nodes.map((node) => node.id))
    expect(backup.campusMap).toEqual(buildCampusMapFixture())

    expect(canonicalize(makeBackup())).toEqual(canonicalize(backup))

    backup.graph.nodes[0].label = 'mutated-after-export'
    expect(fixture.snapshot.nodes[0].label).not.toBe('mutated-after-export')
  })

  it('validates the exported envelope without errors', () => {
    const result = validateCampusBackup(makeBackup())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.backup?.campusId).toBe(CAMPUS_ID)
  })

  it('round-trips the GraphSnapshot losslessly through validate + import', () => {
    const backup = makeBackup()
    const result = importCampusBackup(backup)

    expect(canonicalGraphSnapshot(result.graph)).toEqual(canonicalGraphSnapshot(fixture.snapshot))
    expect(result.graph.buildings[0].id).toBe(BUILDING_ID)
    expect(result.graph.traces.map((trace) => trace.id).sort()).toEqual([
      'road-cross',
      'road-main',
      'road-sep',
    ])
    expect(result.graph.doors?.map((door) => door.id)).toEqual(['door-a'])
    expect(result.sourceRevision).toBe(SOURCE_REVISION)
    expect(result.campusMap).toEqual(buildCampusMapFixture())
  })

  it('reconstructs a CampusDocument with authored ids, geometry and metadata', () => {
    const backup = makeBackup()
    const { document: doc } = importCampusBackup(backup)
    const sourceBuilding = fixture.document.buildings[0]
    const sourceGround = sourceBuilding.floors[0]
    const sourceUpper = sourceBuilding.floors[1]

    expect(doc.metadata.campusId).toBe(CAMPUS_ID)
    expect(doc.metadata.name).toBe('Backup Fixture Campus')

    const building = doc.buildings[0]
    expect(building.id).toBe(BUILDING_ID)
    expect(building.name).toBe(sourceBuilding.name)
    expect(building.code).toBe(sourceBuilding.code)
    expect(building.description).toBe(sourceBuilding.description)
    expect(building.department).toBe(sourceBuilding.department)
    expect(building.color).toBe(sourceBuilding.color)
    expect(building.rotation).toBe(sourceBuilding.rotation)
    expect(building.baseElevation).toBe(sourceBuilding.baseElevation)
    expect(building.aliases).toEqual(sourceBuilding.aliases)
    expect(building.metadata).toEqual(sourceBuilding.metadata)
    expect(building.staircases).toEqual(sourceBuilding.staircases)
    expect(building.elevators).toEqual(sourceBuilding.elevators)
    expect(building.verticalTransitions).toEqual(sourceBuilding.verticalTransitions)

    const ground = building.floors.find((floor) => floor.level === 0)
    const upper = building.floors.find((floor) => floor.level === 1)
    expect(ground).toBeDefined()
    expect(upper).toBeDefined()
    if (!ground || !upper) return

    expect(ground.id).toBe(sourceGround.id)
    expect(ground.label).toBe(sourceGround.label)
    expect(ground.shortLabel).toBe(sourceGround.shortLabel)
    expect(ground.height).toBe(sourceGround.height)
    expect(ground.elevation).toBe(sourceGround.elevation)
    expect(ground.offset).toEqual(sourceGround.offset)
    expect(ground.planImageId).toBe(sourceGround.planImageId)
    expect(ground.floorPlanState).toBe(sourceGround.floorPlanState)
    expect(ground.metadata).toEqual(sourceGround.metadata)
    expect(ground.walls).toEqual(sourceGround.walls)
    expect(ground.windows).toEqual(sourceGround.windows)
    expect(ground.openings).toEqual(sourceGround.openings)
    expect(ground.roomAttributes).toEqual(sourceGround.roomAttributes)
    expect(ground.routeNetwork).toEqual(sourceGround.routeNetwork)
    expect(ground.entranceAccess).toEqual(sourceGround.entranceAccess)
    expect(ground.doors).toEqual(sourceGround.doors)
    expect(upper.offset).toEqual(sourceUpper.offset)
    expect(upper.metadata).toEqual(sourceUpper.metadata)
    expect(upper.routeNetwork).toEqual(sourceUpper.routeNetwork)

    const roomA = ground.rooms.find((room) => room.id === 'room-a')
    const sourceRoomA = sourceGround.rooms[0]
    expect(roomA).toBeDefined()
    if (!roomA) return
    expect(roomA.name).toBe(sourceRoomA.name)
    expect(roomA.number).toBe(sourceRoomA.number)
    expect(roomA.capacity).toBe(sourceRoomA.capacity)
    expect(roomA.metadata).toEqual(sourceRoomA.metadata)
    expectPointsClose(roomA.polygon.points, sourceRoomA.polygon.points)

    const roomC = upper.rooms.find((room) => room.id === 'room-c')
    expect(roomC).toBeDefined()
    if (!roomC) return
    expect(roomC.name).toBe(sourceUpper.rooms[0].name)
    expectPointsClose(roomC.polygon.points, sourceUpper.rooms[0].polygon.points)

    const hallwayA = ground.hallways.find((hallway) => hallway.id === 'hall-a')
    expect(hallwayA).toBeDefined()
    if (!hallwayA) return
    expect(hallwayA.name).toBe(sourceGround.hallways[0].name)
    expect(hallwayA.width).toBe(sourceGround.hallways[0].width)
    expect(hallwayA.color).toBe(sourceGround.hallways[0].color)
    expectPointsClose(hallwayA.polyline.points, sourceGround.hallways[0].polyline.points)

    const entrance = ground.entrances.find((item) => item.id === 'ent-main')
    expect(entrance).toBeDefined()
    if (!entrance) return
    expect(entrance.label).toBe('Main Entrance')
    expect(entrance.level).toBe(0)
    expect(entrance.hasQR).toBe(true)
    expect(entrance.hasPanorama).toBe(false)

    const indoorPoi = ground.pois?.find((poi) => poi.id === 'poi-indoor-1')
    expect(indoorPoi).toBeDefined()
    if (!indoorPoi) return
    expect(indoorPoi.name).toBe('Vending Machine')
    expect(indoorPoi.category).toBe('vending_machine')
    expect(indoorPoi.metadata).toEqual({ floorNote: 'near hall A' })

    const roadMain = doc.roads.find((road) => road.id === 'road-main')
    const roadCross = doc.roads.find((road) => road.id === 'road-cross')
    expect(roadMain).toBeDefined()
    expect(roadCross).toBeDefined()
    if (!roadMain || !roadCross) return
    expect(roadMain.name).toBe('Main Road')
    expect(roadMain.width).toBe(5)
    expect(roadMain.surface).toBe('concrete')
    expect(roadMain.displayMode).toBe('visible')
    expect(roadMain.routing).toEqual(fixture.document.roads[0].routing)
    expect(roadMain.metadata).toEqual({ department: 'facilities', surface: 'concrete' })
    expectPointsClose(roadMain.polyline.points, fixture.document.roads[0].polyline.points)
    expect(roadCross.type).toBe('arterial')
    expect(roadCross.displayMode).toBe('navigation-only')

    expect(doc.roadJunctions).toHaveLength(1)
    expect(doc.roadJunctions?.[0].id).toBe('junction-1')
    expect(doc.roadJunctions?.[0].roadIds).toEqual(['road-main', 'road-cross'])
    expect(doc.roadJunctions?.[0].source).toBe('authored')

    expect(doc.separatedCrossings).toHaveLength(1)
    expect(doc.separatedCrossings?.[0].id).toBe('sc-1')
    expect(doc.separatedCrossings?.[0].roadIds).toEqual(['road-main', 'road-sep'])

    expect(doc.boundary).toBeDefined()
    if (doc.boundary) {
      expectPointsClose(doc.boundary.points, fixture.document.boundary?.points ?? [])
    }

    const qr = doc.qrCheckpoints.find((checkpoint) => checkpoint.id === 'qr-lobby')
    expect(qr).toBeDefined()
    if (qr) {
      expect(qr.label).toBe('Lobby QR')
      expect(qr.code).toBe('NAVI|bldg-alpha|0|lobby')
      expect(qr.metadata).toEqual({ printed: '2026-09' })
      expect(qr.buildingId).toBe(BUILDING_ID)
      expect(qr.floor).toBe(0)
    }

    const panorama = doc.panoramas.find((item) => item.id === 'pano-main')
    expect(panorama).toBeDefined()
    if (panorama) {
      expect(panorama.label).toBe('Main Lobby 360')
      expect(panorama.buildingId).toBe(BUILDING_ID)
      expect(panorama.floor).toBe(0)
    }

    expect(doc.pois?.find((poi) => poi.id === 'poi-out-1')).toEqual(fixture.document.pois?.[0])
    expect(doc.areas).toEqual(fixture.document.areas)
    expect(doc.connectivitySemanticsVersion).toBe('1.0.0')
  })

  it('re-syncs the imported document to the authored graph (modulo volatile generated ids)', () => {
    const backup = makeBackup()
    const result = importCampusBackup(backup)

    const rebuilt = new Graph()
    rebuilt.campusId = CAMPUS_ID
    new GraphAdapter(rebuilt, result.transformer).sync(result.document)

    const source = new Graph()
    source.campusId = CAMPUS_ID
    new GraphAdapter(source, createTransformerForDocument(fixture.document)).sync(fixture.document)

    expect(normalizeGeneratedGraphIds(rebuilt)).toEqual(normalizeGeneratedGraphIds(source))
    expect(rebuilt.nodeCount).toBe(source.nodeCount)
    expect(rebuilt.edgeCount).toBe(source.edgeCount)
    expect(rebuilt.buildingCount).toBe(source.buildingCount)
    expect(rebuilt.doors.map((door) => door.id).sort()).toEqual(source.doors.map((door) => door.id).sort())
    expect(canonicalize(rebuilt.components)).toEqual(canonicalize(source.components))
    expect(canonicalize(rebuilt.traces)).toEqual(canonicalize(source.traces))
  })

  it('makes no network or storage calls during export, validate or import', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    try {
      const backup = makeBackup()
      expect(validateCampusBackup(backup).valid).toBe(true)
      importCampusBackup(backup)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(getItem).not.toHaveBeenCalled()
      expect(setItem).not.toHaveBeenCalled()
      expect(removeItem).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it('falls back to the campus id for the document name when no campus map is supplied', () => {
    const backup = createCampusBackup({
      campusId: CAMPUS_ID,
      revision: null,
      graph: fixture.snapshot,
      exportedAt: FIXED_EXPORTED_AT,
    })
    const { document: doc, sourceRevision, campusMap } = importCampusBackup(backup)
    expect(doc.metadata.name).toBe(CAMPUS_ID)
    expect(sourceRevision).toBeNull()
    expect(campusMap).toBeUndefined()
  })

  it('rejects invalid backups instead of importing them', () => {
    const tampered = structuredClone(makeBackup())
    tampered.graph.edges[0].to = 'missing-node'

    expect(() => importCampusBackup(tampered)).toThrow(CampusBackupImportError)

    try {
      importCampusBackup(tampered)
      expect.unreachable('importCampusBackup should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(CampusBackupImportError)
      const importError = error as CampusBackupImportError
      expect(importError.errors.some((issue) => issue.code === 'dangling-edge')).toBe(true)
    }
  })
})
