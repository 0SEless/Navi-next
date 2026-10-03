import { describe, it, expect } from 'vitest'
import {
  CoordinateTransformer,
  type CampusDocument,
  type RoomDoor,
  type Building,
} from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { serializeSnapshot } from '@/services/graph-snapshot-serializer'
import { parseAuthoredGraphPayload } from '@/services/authored-snapshot-persistence'
import { evaluateAuthoredSave } from '@/store/authored-mutation-intent'
import type { GuardCollections } from '@/lib/save-safety-guard'

function collectionsOf(snapshot: any): GuardCollections {
  const asEntityList = (arr: any) =>
    (Array.isArray(arr) ? arr : []).map((e: any) => ({
      id: String(e.id ?? ''),
      buildingId: e.buildingId ?? null,
      floor: e.floor ?? null,
      from: e.from,
      to: e.to,
    }))
  return {
    buildings: asEntityList(snapshot.buildings),
    components: asEntityList(snapshot.components),
    nodes: asEntityList(snapshot.nodes),
    edges: asEntityList(snapshot.edges),
    traces: asEntityList(snapshot.traces),
    doors: asEntityList(snapshot.doors),
  }
}

function createSampleCampus(): CampusDocument {
  const building: Building = {
    id: 'bld-alpha',
    name: 'Alpha Hall',
    code: 'AH',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 10.0, lng: 120.0 },
        { lat: 10.001, lng: 120.0 },
        { lat: 10.001, lng: 120.001 },
        { lat: 10.0, lng: 120.001 },
        { lat: 10.0, lng: 120.0 },
      ],
    },
    baseElevation: 0,
    height: 10,
    floors: [
      {
        id: 'flr-alpha-0',
        level: 0,
        label: 'Ground Floor',
        elevation: 0,
        rooms: [],
        doors: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        walls: [],
      },
      {
        id: 'flr-alpha-1',
        level: 1,
        label: 'Second Floor',
        elevation: 3.5,
        rooms: [],
        doors: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        walls: [],
      },
    ],
    staircases: [],
    elevators: [],
  }

  return {
    id: 'campus-test',
    schemaVersion: 1,
    version: 1,
    metadata: {
      name: 'Test Campus',
      lastModified: new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: [building],
    roads: [],
    pois: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('Floor Door Persistence Round-Trip', () => {
  it('places a door on floor 0 and preserves it through graph serialization and authored snapshot', () => {
    const doc = createSampleCampus()
    const building = doc.buildings[0]
    const floor0 = building.floors[0]

    const initialGraph = new Graph()
    const transformer = new CoordinateTransformer(building.footprint.points)
    const initialAdapter = new GraphAdapter(initialGraph, transformer)
    initialAdapter.sync(doc)

    const baseCollections = collectionsOf(initialGraph.toJSON())

    // Author a door on floor 0
    const testDoor: RoomDoor = {
      id: 'door-main-entrance',
      name: 'Main Door',
      doorType: 'standard',
      position: { x: 5, y: 5 },
      width: 1.2,
      depth: 0.3,
      rotation: 0,
      geometry: {
        type: 'rectangle',
        min: { x: 4.4, y: 4.85 },
        max: { x: 5.6, y: 5.15 },
        rotation: 0,
      },
      ownership: { status: 'unassigned' },
      metadata: { accessible: true },
    }
    floor0.doors = [testDoor]
    doc.version += 1

    // Sync candidate
    const candidateGraph = Graph.fromJSON(initialGraph.toJSON())
    const candidateAdapter = new GraphAdapter(candidateGraph, transformer)
    const floorScope = { kind: 'floor' as const, buildingId: building.id, floor: 0 }
    candidateAdapter.sync(doc, floorScope)

    const candidateSnapshot = candidateGraph.toJSON()
    const candidateCollections = collectionsOf(candidateSnapshot)

    // 1. Verify safety guard approves floor-scoped save with the new door
    const pendingIntent = [{
      seq: 1,
      kind: 'floor' as const,
      buildingId: building.id,
      floor: 0,
      componentId: null,
      at: Date.now(),
    }]
    const verdict = evaluateAuthoredSave(baseCollections, candidateCollections, pendingIntent)
    expect(verdict.allowed).toBe(true)

    // 2. Verify graph projection contains projected door
    expect(candidateGraph.doors.length).toBeGreaterThanOrEqual(1)
    const projected = candidateGraph.doors.find((d) => d.id === testDoor.id)
    expect(projected).toBeDefined()
    expect(projected?.buildingId).toBe(building.id)
    expect(projected?.floor).toBe(0)

    // 3. Verify RPC serialization includes both graph and authored document companion
    const payload = serializeSnapshot(candidateSnapshot as any, 'campus-test', doc)
    expect(payload.authoredDocument).toBeDefined()
    expect(payload.authoredDocument?.buildings[0]?.floors[0]?.doors).toHaveLength(1)
    expect(payload.authoredDocument?.buildings[0]?.floors[0]?.doors?.[0]?.id).toBe(testDoor.id)

    // 4. Verify deserialization from persisted payload reconstructs the door
    const parsed = parseAuthoredGraphPayload(payload as any)
    expect(parsed.authoredDocument).not.toBeNull()
    const restoredDoc = parsed.authoredDocument!
    const restoredFloor = restoredDoc.buildings[0].floors[0]
    expect(restoredFloor.doors).toHaveLength(1)
    expect(restoredFloor.doors?.[0]).toEqual(testDoor)

    // 5. Verify un-affected floor 1 remains untouched
    expect(restoredDoc.buildings[0].floors[1].doors).toHaveLength(0)
  })

  it('preserves doors across multiple floors during floor-scoped syncs', () => {
    const doc = createSampleCampus()
    const building = doc.buildings[0]
    const transformer = new CoordinateTransformer(building.footprint.points)
    const graph = new Graph()
    const adapter = new GraphAdapter(graph, transformer)

    // Door on Floor 0
    building.floors[0].doors = [{
      id: 'door-f0-1',
      name: 'F0 Door',
      doorType: 'standard',
      position: { x: 3, y: 3 },
      width: 1.0,
      ownership: { status: 'unassigned' },
      metadata: {},
    }]
    adapter.sync(doc, { kind: 'floor', buildingId: building.id, floor: 0 })

    // Door on Floor 1
    building.floors[1].doors = [{
      id: 'door-f1-1',
      name: 'F1 Door',
      doorType: 'standard',
      position: { x: 3, y: 3 },
      width: 1.0,
      ownership: { status: 'unassigned' },
      metadata: {},
    }]
    // Sync only Floor 1 scope
    adapter.sync(doc, { kind: 'floor', buildingId: building.id, floor: 1 })

    // Both doors must exist in projected graph doors
    expect(graph.doors).toHaveLength(2)
    const f0Door = graph.doors.find(d => d.id === 'door-f0-1')
    const f1Door = graph.doors.find(d => d.id === 'door-f1-1')
    expect(f0Door).toBeDefined()
    expect(f1Door).toBeDefined()
    expect(f0Door?.floor).toBe(0)
    expect(f1Door?.floor).toBe(1)
  })
})
