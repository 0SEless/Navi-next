import { describe, it, expect, expectTypeOf } from 'vitest'
import type { Staircase, StairLevelGeometry, Elevator, ElevatorLevelGeometry, Building } from '../entities'
import type { LocalPolygon } from '../coordinates'

const ring = (): LocalPolygon => ({ points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }] })

function buildStaircase(): Staircase {
  return {
    id: 'stair-well-a',
    buildingId: 'bld-main',
    name: 'Stairwell A',
    type: 'enclosed',
    accessible: true,
    fromLevel: 0,
    toLevel: 2,
    levels: {
      0: {
        position: { x: 10, y: 10 },
        rotation: 90,
        polygon: ring(),
        drawing: {
          definitionId: 'stair',
          properties: { stepCount: 12, stepWidth: 1.4, stepDepth: 0.3, direction: 'north', preset: 'straight' },
        },
      },
      1: {
        position: { x: 10, y: 12 },
        rotation: 90,
        polygon: ring(),
        landing: {
          position: { x: 10, y: 14 },
          rotation: 0,
          polygon: { points: [{ x: 8, y: 14 }, { x: 12, y: 14 }, { x: 12, y: 16 }, { x: 8, y: 16 }, { x: 8, y: 14 }] },
        },
      },
      2: {
        position: { x: 10, y: 14 },
        rotation: 180,
      },
    },
  }
}

function buildElevator(): Elevator {
  return {
    id: 'elev-bank-1',
    buildingId: 'bld-main',
    name: 'Main Elevator Bank',
    type: 'passenger',
    accessible: true,
    fromLevel: 0,
    toLevel: 2,
    levels: {
      0: {
        position: { x: 30, y: 30 },
        rotation: 0,
        polygon: ring(),
        drawing: {
          definitionId: 'elevator',
          properties: { width: 1.8, depth: 1.5, doorSide: 'front' },
        },
      },
      1: {
        position: { x: 30, y: 30 },
        rotation: 0,
        polygon: ring(),
        landing: {
          position: { x: 30, y: 34 },
        },
      },
      2: {
        position: { x: 30, y: 30 },
        rotation: 0,
      },
    },
  }
}

describe('Staircase feature entity', () => {
  it('type-checks every field of the locked shape', () => {
    const stair = buildStaircase()

    expect(stair.id).toBe('stair-well-a')
    expect(stair.buildingId).toBe('bld-main')
    expect(stair.name).toBe('Stairwell A')
    expect(stair.type).toBe('enclosed')
    expect(stair.accessible).toBe(true)
    expect(stair.fromLevel).toBe(0)
    expect(stair.toLevel).toBe(2)

    expect(Object.keys(stair.levels).map(Number).sort()).toEqual([0, 1, 2])

    const level0: StairLevelGeometry = stair.levels[0]
    expect(level0.position).toEqual({ x: 10, y: 10 })
    expect(level0.rotation).toBe(90)
    expect(level0.polygon?.points).toHaveLength(5)
    expect(level0.drawing).toEqual({
      definitionId: 'stair',
      properties: { stepCount: 12, stepWidth: 1.4, stepDepth: 0.3, direction: 'north', preset: 'straight' },
    })

    const level1: StairLevelGeometry = stair.levels[1]
    expect(level1.polygon).toBeDefined()
    expect(level1.landing?.position).toEqual({ x: 10, y: 14 })
    expect(level1.landing?.rotation).toBe(0)
    expect(level1.landing?.polygon?.points).toHaveLength(5)

    const level2: StairLevelGeometry = stair.levels[2]
    expect(level2.position).toEqual({ x: 10, y: 14 })
    expect(level2.rotation).toBe(180)
    expect(level2.polygon).toBeUndefined()
    expect(level2.drawing).toBeUndefined()

    const drawing = level0.drawing!
    expectTypeOf(drawing.definitionId).toEqualTypeOf<'stair'>()
    expectTypeOf(drawing.properties.stepCount).toBeNumber()
    expectTypeOf(drawing.properties.stepWidth).toBeNumber()
    expectTypeOf(drawing.properties.stepDepth).toBeNumber()
    expectTypeOf(drawing.properties.direction).toBeString()
    expectTypeOf(drawing.properties.preset).toBeString()
  })

  it('round-trips through JSON with every field intact', () => {
    const stair = buildStaircase()
    const restored = JSON.parse(JSON.stringify(stair)) as Staircase

    expect(restored).toEqual(stair)
    expect(restored.levels[0].drawing?.properties.stepCount).toBe(12)
    expect(restored.levels[0].polygon?.points).toHaveLength(5)
    expect(restored.levels[1].landing?.position).toEqual({ x: 10, y: 14 })
    expect(restored.levels[2].rotation).toBe(180)
  })

  it('holds the two documented invariants for the fixture', () => {
    const stair = buildStaircase()
    expect(stair.fromLevel).toBeLessThanOrEqual(stair.toLevel)
    const keys = Object.keys(stair.levels).map(Number)
    for (const k of keys) {
      expect(k).toBeGreaterThanOrEqual(stair.fromLevel)
      expect(k).toBeLessThanOrEqual(stair.toLevel)
    }
  })
})

describe('Elevator feature entity', () => {
  it('type-checks every field of the locked shape', () => {
    const elev = buildElevator()

    expect(elev.id).toBe('elev-bank-1')
    expect(elev.buildingId).toBe('bld-main')
    expect(elev.name).toBe('Main Elevator Bank')
    expect(elev.type).toBe('passenger')
    expect(elev.accessible).toBe(true)
    expect(elev.fromLevel).toBe(0)
    expect(elev.toLevel).toBe(2)

    const level0: ElevatorLevelGeometry = elev.levels[0]
    expect(level0.polygon?.points).toHaveLength(5)
    expect(level0.drawing).toEqual({
      definitionId: 'elevator',
      properties: { width: 1.8, depth: 1.5, doorSide: 'front' },
    })

    const level1: ElevatorLevelGeometry = elev.levels[1]
    expect(level1.landing?.position).toEqual({ x: 30, y: 34 })
    expect(level1.landing?.rotation).toBeUndefined()
    expect(level1.landing?.polygon).toBeUndefined()

    const drawing = level0.drawing!
    expectTypeOf(drawing.definitionId).toEqualTypeOf<'elevator'>()
    expectTypeOf(drawing.properties.width).toBeNumber()
    expectTypeOf(drawing.properties.depth).toBeNumber()
    expectTypeOf(drawing.properties.doorSide).toBeString()
  })

  it('round-trips through JSON with every field intact', () => {
    const elev = buildElevator()
    const restored = JSON.parse(JSON.stringify(elev)) as Elevator

    expect(restored).toEqual(elev)
    expect(restored.levels[0].drawing?.properties).toEqual({ width: 1.8, depth: 1.5, doorSide: 'front' })
    expect(restored.levels[1].landing?.position).toEqual({ x: 30, y: 34 })
    expect(restored.levels[2].polygon).toBeUndefined()
  })

  it('holds the two documented invariants for the fixture', () => {
    const elev = buildElevator()
    expect(elev.fromLevel).toBeLessThanOrEqual(elev.toLevel)
    const keys = Object.keys(elev.levels).map(Number)
    for (const k of keys) {
      expect(k).toBeGreaterThanOrEqual(elev.fromLevel)
      expect(k).toBeLessThanOrEqual(elev.toLevel)
    }
  })
})

describe('Building feature arrays', () => {
  it('accepts feature entity arrays on Building.staircases / Building.elevators', () => {
    const building = {
      id: 'bld-main',
      name: 'Main Building',
      code: 'MAIN',
      category: 'academic' as const,
      description: '',
      footprint: { points: [] },
      baseElevation: 0,
      height: 30,
      floors: [],
      verticalConnectors: [],
      color: '#ff0000',
      aliases: [],
      metadata: {},
      staircases: [buildStaircase()],
      elevators: [buildElevator()],
    } satisfies Building

    const stairs: Staircase[] | undefined = building.staircases
    const elevs: Elevator[] | undefined = building.elevators
    expect(stairs).toHaveLength(1)
    expect(elevs).toHaveLength(1)
  })
})
