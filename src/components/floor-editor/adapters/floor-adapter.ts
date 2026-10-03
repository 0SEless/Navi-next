'use client'

import { useEffect, useMemo } from 'react'
import type { Viewport } from '@navi/editor'
import type { Building } from '@/types/nav-types'

const FLOOR_ID_PREFIX = 'flr-'

interface FloorDataRecord {
  id?: string
  level?: number
}

function indexToId(floors: number[], idx: number, floorData?: Record<string, unknown>[]): string | null {
  if (idx < 0 || idx >= floors.length) return null
  const level = floors[idx]
  const records = floorData as unknown as FloorDataRecord[] | undefined
  const fd = records?.find((f) => f.level === level)
  if (fd && typeof fd.id === 'string') {
    return fd.id
  }
  return `${FLOOR_ID_PREFIX}${level}`
}

function idToIndex(floors: number[], id: string | null, floorData?: Record<string, unknown>[]): number {
  if (!id) return 0
  if (floorData) {
    const records = floorData as unknown as FloorDataRecord[]
    const fd = records.find((f) => f.id === id)
    if (fd && typeof fd.level === 'number') {
      const idx = floors.indexOf(fd.level)
      if (idx >= 0) return idx
    }
  }
  if (id.startsWith(FLOOR_ID_PREFIX)) {
    const level = parseInt(id.slice(FLOOR_ID_PREFIX.length), 10)
    if (!isNaN(level)) {
      const idx = floors.indexOf(level)
      if (idx >= 0) return idx
    }
  }
  return 0
}

export function useFloorAdapter(
  viewport: Viewport,
  building: Building | null,
  floorIndex: number,
) {
  const floors = useMemo(() => building?.floors ?? [], [building?.floors])
  const floorData = building?.floorData

  useEffect(() => {
    const resolvedIndex = floors.indexOf(floorIndex) >= 0 ? floors.indexOf(floorIndex) : floorIndex
    const id = indexToId(floors, resolvedIndex, floorData)
    if (id && id !== viewport.activeFloorId) {
      viewport.setActiveFloor(id)
    }
  }, [viewport, floors, floorIndex, floorData])

  return {
    get activeFloorIndex() { return idToIndex(floors, viewport.activeFloorId, floorData) },
    selectFloor: (idx: number) => {
      const id = indexToId(floors, idx, floorData)
      if (id) viewport.setActiveFloor(id)
    },
  }
}
