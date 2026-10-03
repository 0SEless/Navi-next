'use client'

import { useMemo } from 'react'
import type { Wall } from '@navi/core'
import { deriveRooms, type DerivedRoom } from '@navi/editor/src/geometry/room-derivation'
import { wallsToSegments } from '@navi/editor/src/geometry/wall-to-segment'

/**
 * Derive rooms from canonical wall geometry.
 * This is a COMPUTED layer — derived rooms are never persisted to Floor.rooms[].
 * Returns an empty array when walls are absent or empty.
 */
export function useDerivedRooms(walls: Wall[] | undefined): DerivedRoom[] {
  return useMemo(() => {
    if (!walls || walls.length === 0) return []
    const segments = wallsToSegments(walls)
    return deriveRooms(segments, [])
  }, [walls])
}
