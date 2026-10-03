import { describe, expect, it } from 'vitest'
import {
  DERIVED_ROOM_LAYER_IDS,
  isPolygonAuthoringTool,
  readDerivedRoomHit,
} from '../semantic-room-interaction'

describe('production semantic Room interaction contract', () => {
  it('reads faceId and optional semantic roomId from a derived MapLibre feature', () => {
    expect(readDerivedRoomHit({ faceId: 'face-a', roomId: 'room-a' })).toEqual({ faceId: 'face-a', roomId: 'room-a' })
    expect(readDerivedRoomHit({ faceId: 'face-b', roomId: null })).toEqual({ faceId: 'face-b', roomId: undefined })
    expect(readDerivedRoomHit({ id: 'legacy-room' })).toBeNull()
  })

  it('uses derived room layers and excludes the internal space tool from polygon authoring', () => {
    expect(DERIVED_ROOM_LAYER_IDS).toEqual(['floor-derived-rooms-fill', 'floor-derived-rooms-outline'])
    expect(isPolygonAuthoringTool('space')).toBe(false)
    expect(isPolygonAuthoringTool('hallway')).toBe(true)
    expect(isPolygonAuthoringTool('elevator')).toBe(true)
  })
})
