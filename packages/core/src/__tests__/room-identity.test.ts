import { describe, it, expect } from 'vitest'
import type { Floor, RoomAttributes } from '../types/entities'
import {
  SEMANTIC_ROOM_ID_PREFIX,
  canonicalRoomId,
  collectCanonicalRoomIds,
  canonicalRoomIds,
  isKnownRoomId,
} from '../room-identity'

function makeFloor(overrides?: Partial<Floor>): Floor {
  return {
    id: 'floor-1',
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    height: 3.5,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    metadata: {},
    ...overrides,
  }
}

describe('SEMANTIC_ROOM_ID_PREFIX', () => {
  it('is the canonical fallback prefix', () => {
    expect(SEMANTIC_ROOM_ID_PREFIX).toBe('semantic-room-')
  })
})

describe('canonicalRoomId', () => {
  it('returns roomId when present', () => {
    expect(canonicalRoomId({ roomId: 'sem-room-1', faceId: 'face-1' })).toBe('sem-room-1')
  })

  it('falls back to semantic-room-<faceId> when roomId is absent', () => {
    expect(canonicalRoomId({ faceId: 'face-1' })).toBe('semantic-room-face-1')
    expect(canonicalRoomId({ roomId: undefined, faceId: 'face-1' })).toBe('semantic-room-face-1')
  })

  it('accepts a full RoomAttributes value', () => {
    const attributes: RoomAttributes = {
      faceId: 'face-9',
      name: 'Lab 9',
      searchable: true,
    }
    expect(canonicalRoomId(attributes)).toBe('semantic-room-face-9')
  })
})

describe('collectCanonicalRoomIds', () => {
  it('unions legacy room ids and canonical attribute ids', () => {
    const floor = {
      rooms: [{ id: 'legacy-1' }, { id: 'legacy-2' }],
      roomAttributes: [
        { roomId: 'sem-room-1', faceId: 'face-1' },
        { faceId: 'face-2' },
      ],
    }

    const ids = collectCanonicalRoomIds(floor)

    expect(ids).toEqual(
      new Set(['legacy-1', 'legacy-2', 'sem-room-1', 'semantic-room-face-2']),
    )
  })

  it('deduplicates ids shared across legacy rooms and attributes', () => {
    const floor = {
      rooms: [{ id: 'shared-1' }, { id: 'shared-1' }],
      roomAttributes: [
        { roomId: 'shared-1', faceId: 'face-1' },
        { roomId: 'shared-1', faceId: 'face-2' },
      ],
    }

    const ids = collectCanonicalRoomIds(floor)

    expect(ids.size).toBe(1)
    expect(ids.has('shared-1')).toBe(true)
  })

  it('does not include the raw faceId when a roomId is present', () => {
    const floor = {
      rooms: [],
      roomAttributes: [{ roomId: 'sem-room-1', faceId: 'face-1' }],
    }

    const ids = collectCanonicalRoomIds(floor)

    expect(ids.has('sem-room-1')).toBe(true)
    expect(ids.has('face-1')).toBe(false)
  })

  it('handles a floor without roomAttributes', () => {
    const ids = collectCanonicalRoomIds({ rooms: [{ id: 'legacy-1' }] })
    expect(ids).toEqual(new Set(['legacy-1']))
  })
})

describe('canonicalRoomIds', () => {
  it('returns a sorted, duplicate-free array', () => {
    const floor = {
      rooms: [{ id: 'zeta' }, { id: 'alpha' }],
      roomAttributes: [
        { roomId: 'mid', faceId: 'face-1' },
        { faceId: 'beta' },
        { faceId: 'beta' },
      ],
    }

    expect(canonicalRoomIds(floor)).toEqual([
      'alpha',
      'mid',
      'semantic-room-beta',
      'zeta',
    ])
  })

  it('is stable across calls (fingerprint input)', () => {
    const floor = {
      rooms: [{ id: 'legacy-b' }, { id: 'legacy-a' }],
      roomAttributes: [{ roomId: 'sem-room-c', faceId: 'face-1' }],
    }

    expect(canonicalRoomIds(floor)).toEqual(canonicalRoomIds(floor))
  })
})

describe('isKnownRoomId', () => {
  const floor = {
    rooms: [{ id: 'legacy-1' }],
    roomAttributes: [
      { roomId: 'sem-room-1', faceId: 'face-1' },
      { faceId: 'face-2' },
    ],
  }

  it('returns true for a legacy room id', () => {
    expect(isKnownRoomId(floor, 'legacy-1')).toBe(true)
  })

  it('returns true for a canonical attribute id', () => {
    expect(isKnownRoomId(floor, 'sem-room-1')).toBe(true)
  })

  it('returns true for the fallback semantic-room-<faceId> form', () => {
    expect(isKnownRoomId(floor, 'semantic-room-face-2')).toBe(true)
  })

  it('returns false for unknown ids and raw face ids', () => {
    expect(isKnownRoomId(floor, 'nope')).toBe(false)
    expect(isKnownRoomId(floor, 'face-1')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isKnownRoomId(floor, undefined)).toBe(false)
  })

  it('works with a full Floor value', () => {
    const fullFloor = makeFloor({
      roomAttributes: [{ faceId: 'face-3', name: 'Room 3', searchable: true }],
    })
    expect(isKnownRoomId(fullFloor, 'semantic-room-face-3')).toBe(true)
  })
})
