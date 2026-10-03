import { describe, expect, it } from 'vitest'
import type { CampusDocument, CoordinateTransformer, Wall } from '@navi/core'
import { deriveRooms } from '@navi/editor/src/geometry/room-derivation'
import { wallsToSegments } from '@navi/editor/src/geometry/wall-to-segment'
import { semanticRoomUpdateHandler } from '@navi/editor/src/commands/semantic-room-handlers'
import { extractFloorComponents, isSemanticRoomComponent } from '../floor-graph-selectors'

const walls: Wall[] = [
  { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 },
  { id: 'w2', start: { x: 10, y: 0 }, end: { x: 10, y: 8 }, thickness: 0.15, height: 3.5 },
  { id: 'w3', start: { x: 10, y: 8 }, end: { x: 0, y: 8 }, thickness: 0.15, height: 3.5 },
  { id: 'w4', start: { x: 0, y: 8 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3.5 },
]

const transformer = {
  buildingLocalToWorld: (point: { x: number; y: number }) => ({ lat: point.y, lng: point.x }),
} as unknown as CoordinateTransformer

function createDoc(floor: any): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{ id: 'bld-1', name: 'Test', code: 'T', category: 'academic', description: '',
      footprint: { points: [] }, baseElevation: 0, height: 20, color: '#000', aliases: [], metadata: {}, floors: [floor], verticalConnectors: [] }],
    roads: [], panoramas: [], qrCheckpoints: [],
  } as CampusDocument
}

describe('semantic Room component projection', () => {
  it('projects RoomAttributes onto derived geometry while preserving legacy Rooms separately', () => {
    const faceId = deriveRooms(wallsToSegments(walls), [])[0].faceId!
    const floor = {
      id: 'flr-1', level: 0, rooms: [{ id: 'legacy-room', name: 'Legacy', number: 'L1', polygon: { points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] } }],
      hallways: [], staircases: [], elevators: [], entrances: [], parametricComponents: [], walls,
      roomAttributes: [{ roomId: 'semantic-room-1', faceId, name: 'Computer Laboratory', type: 'laboratory', code: 'CL-101', description: 'A computing room', searchable: true }],
    }

    const components = extractFloorComponents(createDoc(floor), 'bld-1', floor, transformer)
    const legacy = components.find((component) => component.id === 'legacy-room')
    const semantic = components.find((component) => component.id === 'semantic-room-1')

    expect(legacy).toBeDefined()
    expect(isSemanticRoomComponent(legacy)).toBe(false)
    expect(semantic).toMatchObject({ id: 'semantic-room-1', type: 'room', name: 'Computer Laboratory', floor: 0 })
    expect(semantic?.polygon).toHaveLength(5)
    expect(isSemanticRoomComponent(semantic)).toBe(true)
    expect(semantic?.metadata).toMatchObject({ source: 'derived-face', semanticRoom: true, faceId, roomId: 'semantic-room-1', type: 'laboratory', code: 'CL-101', description: 'A computing room', searchable: true })
  })

  it('uses the canonical semantic id for attributes without a roomId', () => {
    const faceId = deriveRooms(wallsToSegments(walls), [])[0].faceId!
    const floor = {
      id: 'flr-1', level: 0, rooms: [],
      hallways: [], staircases: [], elevators: [], entrances: [], parametricComponents: [], walls,
      roomAttributes: [{ faceId, name: 'Unassigned Lab', searchable: true }],
    }

    const components = extractFloorComponents(createDoc(floor), 'bld-1', floor, transformer)
    const canonicalId = `semantic-room-${faceId}`
    const semantic = components.find((component) => component.id === canonicalId)

    expect(semantic).toMatchObject({ id: canonicalId, type: 'room', name: 'Unassigned Lab' })
    expect(semantic?.metadata).toMatchObject({ source: 'derived-face', semanticRoom: true, faceId, roomId: canonicalId })
    expect(isSemanticRoomComponent(semantic)).toBe(true)
  })

  it('maps legacy number/category values into canonical Code/Type metadata', () => {
    const faceId = deriveRooms(wallsToSegments(walls), [])[0].faceId!
    const floor = {
      id: 'flr-1', level: 0, rooms: [],
      hallways: [], staircases: [], elevators: [], entrances: [], parametricComponents: [], walls,
      roomAttributes: [{ roomId: 'legacy-semantic-room', faceId, name: 'Legacy Room', number: 'L-101', category: 'office', searchable: true }],
    }

    const components = extractFloorComponents(createDoc(floor), 'bld-1', floor, transformer)
    const semantic = components.find((component) => component.id === 'legacy-semantic-room')

    expect(semantic).toMatchObject({ name: 'Legacy Room' })
    expect(semantic?.metadata).toMatchObject({ type: 'office', code: 'L-101', searchable: true })
  })

  it('shows edited semantic metadata in the projected component without changing its derived polygon', () => {
    const faceId = deriveRooms(wallsToSegments(walls), [])[0].faceId!
    const floor = {
      id: 'flr-1', level: 0, rooms: [],
      hallways: [], staircases: [], elevators: [], entrances: [], parametricComponents: [], walls,
      roomAttributes: [{ roomId: 'semantic-room-1', faceId, name: 'Old Room', type: 'classroom', code: '101', description: 'Old description', searchable: true }],
    }
    const doc = createDoc(floor)
    const before = extractFloorComponents(doc, 'bld-1', floor, transformer).find((component) => component.id === 'semantic-room-1')!

    const result = semanticRoomUpdateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1', roomId: 'semantic-room-1',
      changes: { name: 'New Room', type: 'laboratory', code: 'LAB-204', description: 'Updated description', searchable: false },
    })

    expect(result.success).toBe(true)
    const after = extractFloorComponents(doc, 'bld-1', floor, transformer).find((component) => component.id === 'semantic-room-1')!
    expect(after).toMatchObject({ name: 'New Room', type: 'room' })
    expect(after.metadata).toMatchObject({ type: 'laboratory', code: 'LAB-204', description: 'Updated description', searchable: false })
    expect(after.polygon).toEqual(before.polygon)
  })

  it('uses readable labels for route graph projections while preserving raw IDs', () => {
    const floor = {
      id: 'flr-1', level: 0, rooms: [],
      hallways: [], staircases: [], elevators: [], entrances: [], parametricComponents: [], walls: [],
      routeNetwork: {
        nodes: [
          { id: 'route-node-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'route-node-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
        ],
        edges: [{ id: 'route-edge-a', from: 'route-node-a', to: 'route-node-b', type: 'walk', distance: 10 }],
      },
    }

    const components = extractFloorComponents(createDoc(floor), 'bld-1', floor, transformer)
    const firstNode = components.find((component) => component.id === 'route-node-a')
    const secondNode = components.find((component) => component.id === 'route-node-b')
    const edge = components.find((component) => component.id === 'route-edge-a')

    expect(firstNode?.name).toBe('Waypoint 1')
    expect(secondNode?.name).toBe('Waypoint 2')
    expect(edge?.name).toBe('Route segment 1')
    expect(firstNode?.id).toBe('route-node-a')
    expect(edge?.id).toBe('route-edge-a')
  })

  it('projects a spatial Door rectangle for canvas, Inspector, and Outliner selection', () => {
    const floor = {
      id: 'flr-1', level: 0, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], parametricComponents: [], walls: [],
      doors: [{
        id: 'door-1', roomId: 'room-1', ownership: { status: 'assigned' }, name: 'Main Door', doorType: 'sliding',
        position: { x: 2, y: 1 }, width: 4, depth: 2, rotation: Math.PI / 2,
        geometry: { type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 4, y: 2 }, rotation: Math.PI / 2 }, metadata: {},
      }],
    }
    const door = extractFloorComponents(createDoc(floor), 'bld-1', floor, transformer).find(component => component.id === 'door-1')

    expect(door).toMatchObject({ id: 'door-1', type: 'door', name: 'Main Door', position: { lat: 1, lng: 2 } })
    expect(door?.polygon).toHaveLength(4)
    expect(door?.metadata).toMatchObject({ roomId: 'room-1', doorType: 'sliding', ownershipStatus: 'assigned', width: 4, depth: 2, rotation: Math.PI / 2 })
  })
})
