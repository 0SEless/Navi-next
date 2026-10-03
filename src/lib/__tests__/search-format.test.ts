import { describe, it, expect } from 'vitest'
import { floorLabel, groupResults } from '../search-format'
import type { Building, SearchEntry } from '@/types/nav-types'

const building = (id: string, name: string, code?: string): Building => ({
  id,
  name,
  campusId: 'asu-ibajay',
  floors: [0, 1],
  footprint: [],
  baseElevation: 0,
  height: 0,
  ...(code ? { code } : {}),
})

const room = (id: string, label: string, buildingId: string, floor?: number): SearchEntry => ({
  id,
  label,
  type: 'room',
  nodeId: `node-${id}`,
  ...(buildingId ? { buildingId } : {}),
  ...(floor !== undefined ? { floor } : {}),
})

const bld = (id: string, label: string): SearchEntry => ({
  id,
  label,
  type: 'building',
  nodeId: `node-${id}`,
})

describe('floorLabel', () => {
  it('maps ground floor (0) to GF', () => {
    expect(floorLabel(0)).toBe('GF')
  })

  it('maps positive floors to N-floor labels', () => {
    expect(floorLabel(1)).toBe('1F')
    expect(floorLabel(5)).toBe('5F')
  })

  it('maps negative floors to basement labels', () => {
    expect(floorLabel(-1)).toBe('B1F')
    expect(floorLabel(-3)).toBe('B3F')
  })
})

describe('groupResults', () => {
  it('returns [] for empty input', () => {
    expect(groupResults([], [building('b1', 'One')])).toEqual([])
    expect(groupResults([], [])).toEqual([])
  })

  it('groups rooms under their building in buildings-array order', () => {
    const main = building('b1', 'Main Building', 'M')
    const science = building('b2', 'Science Wing', 'S')
    const entries = [
      room('r1', 'Lab 1', 'b2', 0),
      room('r2', 'Office 2', 'b1', 1),
      room('r3', 'Office 3', 'b1', 0),
    ]
    const groups = groupResults(entries, [main, science])

    expect(groups.map((g) => g.buildingId)).toEqual(['b1', 'b2'])
    expect(groups[0].buildingName).toBe('Main Building')
    expect(groups[0].buildingCode).toBe('M')
    expect(groups[0].entries.map((e) => e.id)).toEqual(['r2', 'r3'])
    expect(groups[1].buildingName).toBe('Science Wing')
    expect(groups[1].entries.map((e) => e.id)).toEqual(['r1'])
  })

  it('omits buildings with no matching entries', () => {
    const groups = groupResults(
      [room('r1', '101', 'b1', 0)],
      [building('b1', 'Main'), building('b2', 'Empty Wing')],
    )
    expect(groups.map((g) => g.buildingId)).toEqual(['b1'])
  })

  it('preserves input (search-rank) order within a group', () => {
    const groups = groupResults(
      [
        room('r1', '101', 'b1', 0),
        bld('b1', 'Main Building'),
        room('r2', '102', 'b1', 1),
      ],
      [building('b1', 'Main Building')],
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].entries.map((e) => e.id)).toEqual(['r1', 'b1', 'r2'])
  })

  it('groups a building entry under its own building when the id matches', () => {
    const groups = groupResults(
      [bld('bld-main', 'Main Building'), room('r1', '101', 'bld-main', 0)],
      [building('bld-main', 'Main Building', 'M')],
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].buildingName).toBe('Main Building')
    expect(groups[0].buildingCode).toBe('M')
    expect(groups[0].entries.map((e) => e.type)).toEqual(['building', 'room'])
  })

  it('falls back to the entry label for unknown building keys', () => {
    const groups = groupResults(
      [bld('x-1', 'Odd Building')],
      [building('b1', 'Main')],
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].buildingId).toBe('x-1')
    expect(groups[0].buildingName).toBe('Odd Building')
  })

  it('groups buildingless rooms into an "unknown" campus group after known ones', () => {
    const groups = groupResults(
      [room('r1', 'Shed', '', 0), room('r2', '101', 'b1', 0)],
      [building('b1', 'Main')],
    )
    expect(groups.map((g) => g.buildingId)).toEqual(['b1', 'unknown'])
    expect(groups[1].buildingName).toBe('Campus')
    expect(groups[1].entries.map((e) => e.id)).toEqual(['r1'])
  })
})
