import { describe, it, expect } from 'vitest'
import { deriveRooms } from '../room-derivation'
import { wallsToSegments } from '../wall-to-segment'
import type { Wall } from '@navi/core'

// ── Helpers ──

function coreWall(id: string, sx: number, sy: number, ex: number, ey: number): Wall {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: 0.15, height: 3.5 }
}

// ── MapLibre integration: derived rooms produce valid GeoJSON ──

describe('W5 MapLibre: Derived rooms produce valid GeoJSON for fill layer', () => {
  it('produces GeoJSON features with correct structure for MapLibre source', () => {
    const coreWalls = [
      coreWall('w1', 0, 0, 10, 0),
      coreWall('w2', 10, 0, 10, 8),
      coreWall('w3', 10, 8, 0, 8),
      coreWall('w4', 0, 8, 0, 0),
    ]

    const segments = wallsToSegments(coreWalls)
    const rooms = deriveRooms(segments, [])

    // Convert to GeoJSON features (simulating what FloorEditorCanvas does)
    const features: GeoJSON.Feature[] = rooms.map((room) => {
      const coords: [number, number][] = room.polygon.points.map((p) => [p.x, p.y])
      return {
        type: 'Feature',
        properties: { id: room.id, name: room.name, category: room.category },
        geometry: { type: 'Polygon', coordinates: [coords] },
      }
    })

    expect(features.length).toBeGreaterThanOrEqual(1)

    const feature = features[0]
    expect(feature.type).toBe('Feature')
    expect(feature.properties).toBeDefined()
    expect(feature.properties!.id).toBeDefined()
    expect(feature.properties!.name).toBeDefined()

    // GeoJSON Polygon must have at least 4 coordinate pairs (3 + closure)
    const geom = feature.geometry as GeoJSON.Polygon
    expect(geom.type).toBe('Polygon')
    expect(geom.coordinates).toHaveLength(1) // one ring
    expect(geom.coordinates[0].length).toBeGreaterThanOrEqual(4)

    // Ring must be closed
    const ring = geom.coordinates[0]
    const first = ring[0]
    const last = ring[ring.length - 1]
    expect(first[0]).toBe(last[0])
    expect(first[1]).toBe(last[1])
  })

  it('handles the full pipeline: Wall[] → WallSegment[] → DerivedRoom[] → GeoJSON', () => {
    // Simulate the exact pipeline from the spec:
    // Floor.walls[] → convert to WallSegment[] → deriveRooms → DerivedRoomGeometry[] → GeoJSON
    const floorWalls: Wall[] = [
      coreWall('w1', 0, 0, 20, 0),
      coreWall('w2', 20, 0, 20, 10),
      coreWall('w3', 20, 10, 0, 10),
      coreWall('w4', 0, 10, 0, 0),
      coreWall('w5', 10, 0, 10, 10),  // divider
    ]

    // Step 1: Convert
    const segments = wallsToSegments(floorWalls)
    expect(segments).toHaveLength(5)

    // Step 2: Derive
    const rooms = deriveRooms(segments, [])
    expect(rooms.length).toBeGreaterThanOrEqual(2)

    // Step 3: Convert to GeoJSON (as FloorEditorCanvas would)
    const features: GeoJSON.Feature[] = rooms.map((room) => {
      const coords: [number, number][] = room.polygon.points.map((p) => [p.x, p.y])
      // Close ring if needed
      if (coords.length >= 2) {
        const first = coords[0]
        const last = coords[coords.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push(first)
        }
      }
      return {
        type: 'Feature',
        properties: { id: room.id, name: room.name },
        geometry: { type: 'Polygon', coordinates: [coords] },
      }
    })

    // Verify valid FeatureCollection
    const collection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    }

    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features.length).toBeGreaterThanOrEqual(2)
    for (const f of collection.features) {
      expect(f.type).toBe('Feature')
      expect(f.geometry.type).toBe('Polygon')
    }
  })

  it('derived rooms do not appear in Floor.walls[] (parallel layer)', () => {
    // Verify that derivation is a side-effect-free computation
    const floorWalls: Wall[] = [
      coreWall('w1', 0, 0, 10, 0),
      coreWall('w2', 10, 0, 10, 8),
      coreWall('w3', 10, 8, 0, 8),
      coreWall('w4', 0, 8, 0, 0),
    ]

    const wallCountBefore = floorWalls.length
    const segments = wallsToSegments(floorWalls)
    deriveRooms(segments, [])

    // Floor.walls[] should be unchanged
    expect(floorWalls.length).toBe(wallCountBefore)
    // No new walls added by derivation
    expect(floorWalls.every((w) => w.thickness === 0.15)).toBe(true)
  })
})
