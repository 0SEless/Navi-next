import { describe, expect, it } from 'vitest'
import type { Wall } from '@navi/core'
import {
  DEFAULT_WALL_JUNCTION_TOLERANCE,
  getWallJunctions,
  moveWallJunction,
  snapWallJunctionPosition,
  validateWallGeometry,
} from '../wall-editing'

function wall(id: string, sx: number, sy: number, ex: number, ey: number): Wall {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: 0.15, height: 3.5 }
}

const traceSnap = {
  gridSize: 1,
  endpointSnap: 0.5,
  gridSnap: 0,
  orthogonalSnap: false,
  angle45Snap: false,
}

describe('wall editing geometry', () => {
  it('groups exact and near-coincident endpoints into one shared junction', () => {
    const junctions = getWallJunctions([
      wall('north', 0, 0, 10, 0),
      wall('east', 10.2, 0.1, 10, 10),
    ])

    const shared = junctions.find((junction) => junction.endpoints.length === 2)
    expect(shared).toBeDefined()
    expect(shared?.endpoints).toEqual([
      { wallId: 'east', endpoint: 'start' },
      { wallId: 'north', endpoint: 'end' },
    ])
  })

  it('moves every endpoint in a shared junction without mutating the original walls', () => {
    const walls = [
      wall('north', 0, 0, 10, 0),
      wall('east', 10, 0, 10, 10),
      wall('south', 10, 10, 0, 10),
      wall('west', 0, 10, 0, 0),
    ]
    const original = structuredClone(walls)
    const junction = getWallJunctions(walls).find((candidate) => candidate.position.x === 10 && candidate.position.y === 0)
    expect(junction).toBeDefined()

    const moved = moveWallJunction(walls, junction!.id, { x: 11, y: -1 })

    expect(moved).not.toBeNull()
    expect(moved?.find((candidate) => candidate.id === 'north')?.end).toEqual({ x: 11, y: -1 })
    expect(moved?.find((candidate) => candidate.id === 'east')?.start).toEqual({ x: 11, y: -1 })
    expect(moved?.find((candidate) => candidate.id === 'south')?.start).toEqual({ x: 10, y: 10 })
    expect(walls).toEqual(original)
  })

  it('snaps a junction to another wall endpoint but excludes its own endpoints', () => {
    const walls = [
      wall('north', 0, 0, 10, 0),
      wall('east', 10, 0, 10, 10),
      wall('south', 10, 10, 0, 10),
      wall('west', 0, 10, 0, 0),
      wall('target', 20, 20, 20, 30),
    ]
    const junction = getWallJunctions(walls).find((candidate) => candidate.position.x === 10 && candidate.position.y === 0)
    expect(junction).toBeDefined()

    const snap = snapWallJunctionPosition({ x: 19.8, y: 20.1 }, walls, junction!.id, traceSnap)

    expect(snap.snapType).toBe('endpoint')
    expect(snap.position).toEqual({ x: 20, y: 20 })
    expect(DEFAULT_WALL_JUNCTION_TOLERANCE).toBeGreaterThan(0)
  })

  it('rejects a move that would create a zero-length wall and leaves the source unchanged', () => {
    const walls = [wall('north', 0, 0, 10, 0)]
    const junction = getWallJunctions(walls).find((candidate) => candidate.position.x === 0 && candidate.position.y === 0)
    expect(junction).toBeDefined()

    expect(moveWallJunction(walls, junction!.id, { x: 10, y: 0 })).toBeNull()
    expect(validateWallGeometry(walls)).toEqual({ valid: true })
    expect(walls[0]).toEqual(wall('north', 0, 0, 10, 0))
  })
})
