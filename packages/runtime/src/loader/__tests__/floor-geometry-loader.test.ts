import { describe, it, expect } from 'vitest'
import type { FloorGeometryFile } from '@navi/core'
import { floorGeometryValidator } from '../validators/floor-geometry-validator'
import { toRuntimeFloorGeometry } from '../runtime-converter'

function validFloorGeometry(): FloorGeometryFile {
  return {
    schemaVersion: '1.0.0',
    formatVersion: 0,
    campusId: 'campus-1',
    buildings: [
      {
        id: 'b1',
        name: 'Building A',
        anchor: { origin: { lat: 14.5, lng: 121.0 }, rotation: 0 },
        floors: [
          {
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            offset: { x: 0, y: 0 },
            rooms: [
              {
                id: 'r1',
                name: 'Room 101',
                number: '101',
                polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] },
              },
            ],
            hallways: [
              {
                id: 'h1',
                name: 'Main Hall',
                polyline: { points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] },
              },
            ],
            staircases: [],
            elevators: [],
            doors: [],
            pois: [],
            qrCheckpoints: [],
          },
        ],
      },
    ],
  }
}

describe('floor-geometry-validator', () => {
  it('accepts a valid floor-geometry artifact', () => {
    expect(floorGeometryValidator.validate(validFloorGeometry())).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(floorGeometryValidator.validate(null)).toBe(false)
    expect(floorGeometryValidator.validate('string')).toBe(false)
  })

  it('rejects missing campusId', () => {
    const data = { ...validFloorGeometry(), campusId: '' }
    expect(floorGeometryValidator.validate(data)).toBe(false)
  })

  it('rejects missing buildings array', () => {
    const data = { ...validFloorGeometry(), buildings: 'not-array' }
    expect(floorGeometryValidator.validate(data)).toBe(false)
  })

  it('rejects building with missing anchor', () => {
    const data = validFloorGeometry()
    ;(data.buildings[0] as any).anchor = null
    expect(floorGeometryValidator.validate(data)).toBe(false)
  })

  it('rejects floor with missing offset', () => {
    const data = validFloorGeometry()
    ;(data.buildings[0].floors[0] as any).offset = null
    expect(floorGeometryValidator.validate(data)).toBe(false)
  })
})

describe('toRuntimeFloorGeometry', () => {
  it('converts file format to runtime artifact preserving all fields', () => {
    const file = validFloorGeometry()
    const artifact = toRuntimeFloorGeometry(file)

    expect(artifact.schemaVersion).toBe(1)
    expect(artifact.formatVersion).toBe(0)
    expect(artifact.campusId).toBe('campus-1')
    expect(artifact.buildings).toHaveLength(1)
    expect(artifact.buildings[0].id).toBe('b1')
    expect(artifact.buildings[0].anchor.origin).toEqual({ lat: 14.5, lng: 121.0 })
    expect(artifact.buildings[0].floors).toHaveLength(1)
    expect(artifact.buildings[0].floors[0].rooms).toHaveLength(1)
    expect(artifact.buildings[0].floors[0].rooms[0].polygon.points).toHaveLength(4)
  })

  it('parses schemaVersion string to number', () => {
    const file = validFloorGeometry()
    file.schemaVersion = '2.3'
    const artifact = toRuntimeFloorGeometry(file)
    expect(artifact.schemaVersion).toBe(2)
  })

  it('defaults to 1 for unparseable schemaVersion', () => {
    const file = validFloorGeometry()
    file.schemaVersion = 'invalid'
    const artifact = toRuntimeFloorGeometry(file)
    expect(artifact.schemaVersion).toBe(1)
  })
})
