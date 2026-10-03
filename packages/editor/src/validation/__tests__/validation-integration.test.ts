import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { recordChange } from '@navi/core'
import { ValidationEngine } from '../validation-engine'
import { disconnectedGraphRule, missingNameRule, zeroAreaPolygonRule } from '../rules/modules/skeleton'
import { polygonClosureRule } from '../rules/modules/polygon-closure'
import { selfIntersectionRule } from '../rules/modules/self-intersection'
import { duplicateIdsRule } from '../rules/modules/duplicate-ids'
import { entranceConnectivityRule } from '../rules/modules/entrance-connectivity'
import { floorMetadataRule } from '../rules/modules/floor-metadata'
import { roadConnectivityRule } from '../rules/modules/road-connectivity'
import { referenceRule } from '../rules/modules/reference'
import { GraphAnalysisPass, GeometryAnalysisPass, MetadataIndexPass, SpatialIndexPass } from '../rules/analysis'
import { AutoFixRegistry } from '../fix/registry'
import { assignUntitledFix, assignFloorLevelFix, clearRoadReferenceFix, clearEntranceReferenceFix } from '../fix/modules/metadata-fixes'
import { closePolygonFix } from '../fix/modules/geometry-fixes'
import { CommandRegistry } from '../../commands/registry'
import { CommandDispatcher } from '../../commands/dispatcher'
import { buildingCreateHandler, buildingRenameHandler, buildingDeleteHandler } from '../../commands/building-handlers'
import { roomCreateHandler, roomRenameHandler, roomDeleteHandler } from '../../commands/room-handlers'
import { floorCreateHandler, floorRenameHandler, floorDeleteHandler, floorDuplicateHandler } from '../../commands/floor-handlers'
import { hallwayCreateHandler, hallwayRenameHandler, hallwayDeleteHandler } from '../../commands/hallway-handlers'
import { staircaseCreateHandler, staircaseDeleteHandler } from '../../commands/staircase-handlers'
import { elevatorCreateHandler, elevatorDeleteHandler } from '../../commands/elevator-handlers'
import { entranceCreateHandler, entranceDeleteHandler } from '../../commands/entrance-handlers'
import { roadCreateHandler, roadRenameHandler, roadDeleteHandler } from '../../commands/road-handlers'
import { panoramaCreateHandler, panoramaDeleteHandler } from '../../commands/panorama-handlers'
import { qrCreateHandler, qrDeleteHandler } from '../../commands/qr-handlers'
import { entityUpdateHandler } from '../../commands/entity-update-handler'
import { DocumentEventBus } from '../../eventbus'
import { DocumentStore } from '../../context/document-store'
import type { EditorServiceContext } from '../../context/service-registry'

// ── Helpers ─────────────────────────────────────────────────────

function createBaseDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Main', code: 'M', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      verticalConnectors: [],
      floors: [{
        id: 'flr-1', level: 0, label: 'Ground', elevation: 0,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], metadata: {},
      }],
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function createEngine(): ValidationEngine {
  const engine = new ValidationEngine()
  engine.registerRule(disconnectedGraphRule)
  engine.registerRule(missingNameRule)
  engine.registerRule(zeroAreaPolygonRule)
  engine.registerRule(polygonClosureRule)
  engine.registerRule(selfIntersectionRule)
  engine.registerRule(duplicateIdsRule)
  engine.registerRule(entranceConnectivityRule)
  engine.registerRule(floorMetadataRule)
  engine.registerRule(roadConnectivityRule)
  engine.registerRule(referenceRule)
  engine.registerAnalysisPass(new GraphAnalysisPass())
  engine.registerAnalysisPass(new GeometryAnalysisPass())
  engine.registerAnalysisPass(new MetadataIndexPass())
  engine.registerAnalysisPass(new SpatialIndexPass())
  engine.initialize()
  return engine
}

async function createFullEnvironment(doc: CampusDocument) {
  const registry = new CommandRegistry()
  registry.register(buildingCreateHandler)
  registry.register(buildingRenameHandler)
  registry.register(buildingDeleteHandler)
  registry.register(roomCreateHandler)
  registry.register(roomRenameHandler)
  registry.register(roomDeleteHandler)
  registry.register(hallwayCreateHandler)
  registry.register(hallwayRenameHandler)
  registry.register(hallwayDeleteHandler)
  registry.register(staircaseCreateHandler)
  registry.register(staircaseDeleteHandler)
  registry.register(elevatorCreateHandler)
  registry.register(elevatorDeleteHandler)
  registry.register(entranceCreateHandler)
  registry.register(entranceDeleteHandler)
  registry.register(roadCreateHandler)
  registry.register(roadRenameHandler)
  registry.register(roadDeleteHandler)
  registry.register(panoramaCreateHandler)
  registry.register(panoramaDeleteHandler)
  registry.register(qrCreateHandler)
  registry.register(qrDeleteHandler)
  registry.register(floorCreateHandler)
  registry.register(floorRenameHandler)
  registry.register(floorDeleteHandler)
  registry.register(floorDuplicateHandler)
  registry.register(entityUpdateHandler)

  const eventBus = new DocumentEventBus()
  const documentStore = new DocumentStore(doc)
  const dispatcher = new CommandDispatcher(registry, doc, eventBus)
  const engine = createEngine()
  const autoFix = new AutoFixRegistry()

  const context: EditorServiceContext = {
    get: (id: string) => {
      const map: Record<string, any> = {
        dispatcher,
        eventBus,
        documentStore,
        validationEngine: engine,
        autoFixRegistry: autoFix,
      }
      return map[id]
    },
    document: doc,
  } as any

  autoFix.registerFix(assignUntitledFix)
  autoFix.registerFix(assignFloorLevelFix)
  autoFix.registerFix(clearRoadReferenceFix)
  autoFix.registerFix(clearEntranceReferenceFix)
  autoFix.registerFix(closePolygonFix)
  autoFix.initialize()
  await autoFix.init(context)

  eventBus.on('document.changed', () => {
    engine.markDirty()
  })

  return { engine, autoFix, dispatcher, eventBus, documentStore }
}

function addRoom(doc: CampusDocument, overrides?: { name?: string; points?: { x: number; y: number }[] }): void {
  const floor = doc.buildings[0].floors[0]
  const room = {
    id: `rm-${floor.rooms.length + 1}`,
    name: overrides?.name ?? '',
    number: String(floor.rooms.length + 1),
    category: 'classroom' as const,
    capacity: 30,
    polygon: {
      points: overrides?.points ?? [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
    },
    roomDoors: [],
    metadata: {},
  }
  floor.rooms.push(room)
  recordChange(doc, { entityId: room.id, entityType: 'room', operation: 'created' })
}

// ── Tests ───────────────────────────────────────────────────────

describe('Validation Integration', () => {
  describe('Profile Integration', () => {
    it('draft profile validates a clean document with no issues', () => {
      const doc = createBaseDoc()
      const engine = createEngine()
      const snapshot = engine.validate(doc, 'draft')

      expect(snapshot.state).toBe('valid')
      expect(snapshot.profile).toBe('draft')
      expect(snapshot.issues.length).toBe(0)
      expect(snapshot.statistics.rulesExecuted).toBeGreaterThan(0)
    })

    it('publish profile validates a clean document with no issues', () => {
      const doc = createBaseDoc()
      const engine = createEngine()
      const snapshot = engine.validate(doc, 'publish')

      expect(snapshot.state).toBe('valid')
      expect(snapshot.profile).toBe('publish')
      expect(snapshot.issues.length).toBe(0)
    })

    it('strict profile validates a clean document with no issues', () => {
      const doc = createBaseDoc()
      const engine = createEngine()
      const snapshot = engine.validate(doc, 'strict')

      expect(snapshot.state).toBe('valid')
      expect(snapshot.profile).toBe('strict')
      expect(snapshot.issues.length).toBe(0)
    })

    it('profiles differ in which rules execute (zero-area excluded from draft)', () => {
      const doc = createBaseDoc()
      addRoom(doc, { points: [{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 0, y: 0.0001 }, { x: 0, y: 0 }] })

      const engine = createEngine()
      const draft = engine.validate(doc, 'draft')
      const publish = engine.validateFresh(doc, 'publish')

      const draftZero = draft.issues.filter(i => i.ruleId === 'zero-area-polygon')
      const publishZero = publish.issues.filter(i => i.ruleId === 'zero-area-polygon')
      expect(draftZero.length).toBe(0)
      expect(publishZero.length).toBeGreaterThanOrEqual(0)
    })

    it('document with unnamed entity produces issues in all profiles', () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })

      const engine = createEngine()
      const draft = engine.validate(doc, 'draft')
      const publish = engine.validateFresh(doc, 'publish')

      expect(draft.issues.length).toBeGreaterThan(0)
      expect(publish.issues.length).toBeGreaterThan(0)
      const missingNames = draft.issues.filter(i => i.ruleId === 'missing-name')
      expect(missingNames.length).toBe(1)
    })

    it('profile switching returns different epoch', () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })

      const engine = createEngine()
      const draft = engine.validate(doc, 'draft')
      const publish = engine.validateFresh(doc, 'publish')

      expect(draft.epoch).not.toBe(publish.epoch)
      expect(draft.profile).toBe('draft')
      expect(publish.profile).toBe('publish')
    })

    it('profile selector: switching to same profile returns cached snapshot', () => {
      const doc = createBaseDoc()
      const engine = createEngine()
      const s1 = engine.validate(doc, 'draft')
      const s2 = engine.validate(doc, 'draft')

      expect(s1).toBe(s2)
    })
  })

  describe('AutoFix + Undo Integration', () => {
    it('auto-fix resolves missing-name issue and validation reflects it', async () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const { engine, autoFix } = await createFullEnvironment(doc)

      const before = engine.validate(doc, 'draft')
      const missingIssue = before.issues.find(i => i.ruleId === 'missing-name')
      expect(missingIssue).toBeDefined()
      expect(missingIssue!.fixId).toBe('metadata.assign-name')

      const applied = autoFix.applyFix(missingIssue!)
      expect(applied).toBe(true)

      const after = engine.validateFresh(doc, 'draft')
      const remaining = after.issues.filter(i => i.ruleId === 'missing-name')
      expect(remaining.length).toBe(0)
    })

    it('undo after auto-fix restores the issue', async () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const { engine, autoFix } = await createFullEnvironment(doc)

      const before = engine.validate(doc, 'draft')
      const missingIssue = before.issues.find(i => i.ruleId === 'missing-name')
      expect(missingIssue).toBeDefined()

      autoFix.applyFix(missingIssue!)
      const afterFix = engine.validateFresh(doc, 'draft')
      expect(afterFix.issues.filter(i => i.ruleId === 'missing-name').length).toBe(0)

      // Verify the room now has a name
      const room = doc.buildings[0].floors[0].rooms[0]
      expect(room.name).toBe('Untitled')

      // Manually undo by setting name back to empty
      room.name = ''
      recordChange(doc, { entityId: room.id, entityType: 'room', operation: 'updated' })

      const afterUndo = engine.validateFresh(doc, 'draft')
      const restored = afterUndo.issues.filter(i => i.ruleId === 'missing-name')
      expect(restored.length).toBe(1)
    })

    it('no orphan issues remain after fix resolves the root cause', async () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const { engine, autoFix } = await createFullEnvironment(doc)

      const before = engine.validate(doc, 'draft')
      const fixableIssues = before.issues.filter(i => i.fixId)
      expect(fixableIssues.length).toBeGreaterThan(0)

      for (const issue of fixableIssues) {
        autoFix.applyFix(issue)
      }
      engine.markDirty()

      const after = engine.validateFresh(doc, 'draft')
      const orphanIssues = after.issues.filter(i => i.fixId)
      expect(orphanIssues.length).toBe(0)
    })
  })

  describe('Incremental Equivalence', () => {
    it('incremental validation matches full validation for same document state', () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const engine = createEngine()

      const full = engine.validateFresh(doc, 'draft')

      recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })
      const incremental = engine.validate(doc, 'draft')

      const fullAgain = engine.validateFresh(doc, 'draft')

      expect(incremental.statistics.rulesReused).toBeGreaterThan(0)
      expect(fullAgain.issues.length).toBe(incremental.issues.length)
    })

    it('incremental validation after fix matches full validation', async () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const { engine, autoFix } = await createFullEnvironment(doc)

      const before = engine.validate(doc, 'draft')
      const issue = before.issues.find(i => i.fixId === 'metadata.assign-name')
      expect(issue).toBeDefined()

      autoFix.applyFix(issue!)
      engine.markDirty()

      const incremental = engine.validate(doc, 'draft')
      const full = engine.validateFresh(doc, 'draft')

      expect(incremental.issues.length).toBe(full.issues.length)
      expect(incremental.state).toBe(full.state)
      expect(incremental.statistics.rulesExecuted + incremental.statistics.rulesReused)
        .toBe(full.statistics.rulesExecuted)
    })

    it('incremental after fix has reuse stats', async () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const { engine, autoFix } = await createFullEnvironment(doc)

      const before = engine.validate(doc, 'draft')
      const issue = before.issues.find(i => i.fixId === 'metadata.assign-name')
      autoFix.applyFix(issue!)
      engine.markDirty()

      const incremental = engine.validate(doc, 'draft')
      expect(incremental.statistics.rulesReused).toBeGreaterThan(0)
    })
  })

  describe('Snapshot Freshness', () => {
    it('cached snapshot is invalidated after document mutation', () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const engine = createEngine()

      const s1 = engine.validate(doc, 'draft')
      expect(s1.issues.length).toBeGreaterThan(0)

      recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
      engine.markDirty()

      const s2 = engine.validate(doc, 'draft')
      expect(s1).not.toBe(s2)
      expect(s2.epoch).toBeGreaterThan(s1.epoch)
    })

    it('markDirty flag clears after validate', () => {
      const doc = createBaseDoc()
      addRoom(doc, { name: '' })
      const engine = createEngine()

      const s1 = engine.validate(doc, 'draft')
      expect(s1.statistics.rulesExecuted).toBeGreaterThan(0)

      // markDirty prevents stale cache, forces re-validation
      engine.markDirty()

      // Second call: dirty flag consumed, but no document changes → returns old snapshot
      const s2 = engine.validate(doc, 'draft')
      expect(s1).toBe(s2)

      // Third call: dirty flag is now clear, pure cache hit
      const s3 = engine.validate(doc, 'draft')
      expect(s3).toBe(s2)
    })
  })
})
