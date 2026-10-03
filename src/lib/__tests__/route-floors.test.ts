import { describe, it, expect } from 'vitest'
import { splitRouteByFloor } from '../route-floors'

const floorOf = (map: Record<string, number | undefined>) => (id: string) => map[id]

describe('splitRouteByFloor', () => {
  it('splits a route into maximal runs of consecutive same-floor nodes', () => {
    const floors = floorOf({ a: 0, b: 0, c: 1, d: 1, e: 0 })
    expect(splitRouteByFloor(['a', 'b', 'c', 'd', 'e'], floors)).toEqual([
      { floor: 0, nodes: ['a', 'b'] },
      { floor: 1, nodes: ['c', 'd'] },
      { floor: 0, nodes: ['e'] },
    ])
  })

  it('keeps a single-floor route as one segment', () => {
    const floors = floorOf({ a: 2, b: 2, c: 2 })
    expect(splitRouteByFloor(['a', 'b', 'c'], floors)).toEqual([
      { floor: 2, nodes: ['a', 'b', 'c'] },
    ])
  })

  it('joins nodes without floor info into the neighboring segment', () => {
    const floors = floorOf({ a: 0, c: 1 })
    expect(splitRouteByFloor(['a', 'x', 'c'], floors)).toEqual([
      { floor: 0, nodes: ['a', 'x'] },
      { floor: 1, nodes: ['c'] },
    ])
  })

  it('backfills the first known floor onto leading unknown nodes', () => {
    const floors = floorOf({ a: 2 })
    expect(splitRouteByFloor(['x', 'a'], floors)).toEqual([
      { floor: 2, nodes: ['x', 'a'] },
    ])
  })

  it('collapses a fully unknown path into a single undefined-floor segment', () => {
    const floors = floorOf({})
    expect(splitRouteByFloor(['a', 'b', 'c'], floors)).toEqual([
      { floor: undefined, nodes: ['a', 'b', 'c'] },
    ])
  })

  it('returns an empty array for an empty path', () => {
    expect(splitRouteByFloor([], () => 0)).toEqual([])
  })

  it('handles a single-node path', () => {
    expect(splitRouteByFloor(['a'], floorOf({ a: 1 }))).toEqual([
      { floor: 1, nodes: ['a'] },
    ])
  })
})
