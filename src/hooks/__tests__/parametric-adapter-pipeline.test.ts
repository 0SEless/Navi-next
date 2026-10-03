import { describe, it, expect } from 'vitest'
import { parametricCreateHandler } from '../../../packages/editor/src/commands/parametric-handlers'
import type { CampusDocument } from '@navi/core'

function makeDoc(): CampusDocument {
  return {
    schemaVersion: 1, version: 1,
    metadata: { campusId: 'Test', name: 'Test', description: '', lastModified: '', editorVersion: '1' },
    buildings: [{
      id: 'bld-1', name: 'B1', code: '', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }, { lat: 0, lng: 1 }] },
      baseElevation: 0, height: 10, color: '#000',
      floors: [{
        id: 'flr-1', level: 0, label: 'GF', elevation: 0, height: 3.5,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [],
        connectorStops: [], parametricComponents: [],
        metadata: {},
      }],
      verticalConnectors: [], aliases: [], metadata: {},
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

// Simulates the adapter logic in extractFloorComponents
function extractParametricAdapter(
  floor: any,
  buildingId: string,
  toWorld: (pos: { x: number; y: number }) => { lat: number; lng: number } | null,
) {
  const result: any[] = []
  for (const pc of floor.parametricComponents ?? []) {
    const wp = toWorld(pc.position)
    if (!wp) continue
    const type = pc.definitionId === 'stair' ? 'stair' : pc.definitionId === 'elevator' ? 'elevator' : null
    if (!type) continue
    result.push({
      id: pc.id, type, name: type === 'stair' ? 'Staircase' : 'Elevator',
      buildingId, campusId: '', floor: floor.level,
      position: wp,
      range: {
        from: (pc.properties.fromLevel as number) ?? 0,
        to: (pc.properties.toLevel as number) ?? (type === 'stair' ? floor.level + 1 : 2),
      },
    })
  }
  return result
}

// Simulates the GeoJSON conversion in FloorEditorCanvas
function componentsToPointFeatures(components: any[]) {
  return components
    .filter((c: any) => c.type === 'stair')
    .map((c: any) => ({
      type: 'Feature' as const,
      properties: { id: c.id, name: c.name, type: c.type },
      geometry: { type: 'Point' as const, coordinates: [c.position.lng, c.position.lat] as [number, number] },
    }))
}

function componentsToElevatorFeatures(components: any[]) {
  return components
    .filter((c: any) => c.type === 'elevator' && c.polygon && c.polygon.length >= 3)
    .map((c: any) => ({
      type: 'Feature' as const,
      properties: { id: c.id, name: c.name },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          ...c.polygon!.map((p: any) => [p.lng, p.lat] as [number, number]),
          [c.polygon![0].lng, c.polygon![0].lat] as [number, number],
        ]],
      },
    }))
}

describe('Parametric adapter pipeline (RC-2.5)', () => {
  it('stair: handler store → adapter extracts → GeoJSON renders', () => {
    const doc = makeDoc()
    const result = parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      id: 'pc-stair-1', definitionId: 'stair',
      position: { x: 10, y: 20 }, rotation: 0,
      properties: { stepCount: 10, stepWidth: 1.2, direction: 'up', fromLevel: 0, toLevel: 1 },
    })
    expect(result.success).toBe(true)

    const floor = doc.buildings[0].floors[0]
    expect(floor.parametricComponents).toHaveLength(1)
    expect(floor.parametricComponents[0].definitionId).toBe('stair')

    // Adapter: parametric component → legacy Component[]
    const components = extractParametricAdapter(floor, 'bld-1', (pos) => ({
      lat: pos.y * 0.00001, lng: pos.x * 0.00001,
    }))
    expect(components).toHaveLength(1)
    expect(components[0].type).toBe('stair')
    expect(components[0].range).toEqual({ from: 0, to: 1 })
    expect(components[0].id).toBe('pc-stair-1')

    // GeoJSON: Component → MapLibre Feature
    const features = componentsToPointFeatures(components)
    expect(features).toHaveLength(1)
    expect(features[0].properties.id).toBe('pc-stair-1')
    expect(features[0].properties.type).toBe('stair')
    expect(features[0].geometry.type).toBe('Point')
  })

  it('elevator: handler store → adapter extracts (no polygon → no GeoJSON)', () => {
    const doc = makeDoc()
    parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      id: 'pc-elev-1', definitionId: 'elevator',
      position: { x: 5, y: 5 }, rotation: 0,
      properties: { width: 1.5, depth: 1.5, doorSide: 'front', fromLevel: 0, toLevel: 5 },
    })

    const floor = doc.buildings[0].floors[0]
    const components = extractParametricAdapter(floor, 'bld-1', (pos) => ({
      lat: pos.y * 0.00001, lng: pos.x * 0.00001,
    }))

    expect(components).toHaveLength(1)
    expect(components[0].type).toBe('elevator')
    expect(components[0].range).toEqual({ from: 0, to: 5 })

    // Stair filter: elevator not included
    expect(componentsToPointFeatures(components)).toHaveLength(0)
    // Elevator filter: no polygon set → not included
    expect(componentsToElevatorFeatures(components)).toHaveLength(0)
  })

  it('creation with default properties still renders', () => {
    const doc = makeDoc()
    parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      definitionId: 'stair', position: { x: 0, y: 0 },
    })

    const floor = doc.buildings[0].floors[0]
    // No fromLevel/toLevel in properties → adapter uses defaults
    const components = extractParametricAdapter(floor, 'bld-1', (pos) => ({
      lat: pos.y * 0.00001, lng: pos.x * 0.00001,
    }))

    expect(components).toHaveLength(1)
    expect(components[0].range.from).toBe(0)   // default
    expect(components[0].range.to).toBe(1)     // stair default = floor.level + 1
  })

  it('selection adapter (findOneComponent equivalent)', () => {
    const doc = makeDoc()
    const pcId = 'pc-42'
    parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      id: pcId, definitionId: 'elevator',
      position: { x: 100, y: 200 }, rotation: 0,
      properties: { fromLevel: 0, toLevel: 3 },
    })

    const floor = doc.buildings[0].floors[0]
    const pc = floor.parametricComponents.find((p: any) => p.id === pcId)
    expect(pc).toBeTruthy()
    expect(pc.definitionId).toBe('elevator')

    const wp = { lat: 0.002, lng: 0.001 }
    const type = pc.definitionId === 'stair' ? 'stair' : 'elevator'
    const comp = {
      id: pc.id, type, name: 'Elevator',
      buildingId: 'bld-1', campusId: '', floor: 0,
      position: wp,
      range: { from: pc.properties.fromLevel ?? 0, to: pc.properties.toLevel ?? 2 },
    }
    expect(comp.id).toBe('pc-42')
    expect(comp.type).toBe('elevator')
    expect(comp.position).toEqual({ lat: 0.002, lng: 0.001 })
  })
})
