'use client'

import { useState, useCallback } from 'react'
import { useEditor, useEditingEngine, genId } from '@navi/editor'
import { useStudioStore } from '@/store/studio-store'
import { useCurrentTool } from './useCurrentTool'
import { pointInPolygon } from '@navi/core'
import type { LatLng } from '@/types/nav-types'

interface EntranceFormState {
  position: LatLng | null
  floor: number
  label: string
}

function findFloorId(building: { id: string; floors: { id: string; level: number }[] }, level: number): string | null {
  return building.floors.find((f) => f.level === level)?.id ?? null
}

export function useEntrancePlacer() {
  const [formState, setFormState] = useState<EntranceFormState | null>(null)
  const tool = useCurrentTool()
  const activeFloor = useStudioStore((s) => s.activeFloor)
  const activeBuildingId = useStudioStore((s) => s.activeBuildingId)

  const { document, services, transformer } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get('dispatcher')!
  const workflow = services.get('workflow')!

  const handleMapClick = useCallback((position: LatLng) => {
    if (tool !== 'entrance') return
    const buildings = document.buildings
    const hitBuilding = buildings.find((b) => {
      const pts = b.footprint?.points ?? []
      return pts.length >= 3 && pointInPolygon(position, { points: pts })
    })
    if (hitBuilding) {
      setFormState({ position, floor: activeFloor, label: '' })
    }
  }, [tool, document.buildings, activeFloor])

  const confirmPlacement = useCallback(() => {
    if (!formState?.position) return
    const targetBuilding = activeBuildingId
      ? document.buildings.find((b) => b.id === activeBuildingId)
      : document.buildings.find((b) => pointInPolygon(formState.position!, { points: b.footprint?.points ?? [] }))
    if (!targetBuilding) return

    const floorId = findFloorId(targetBuilding, formState.floor)
    if (!floorId) return

    const entranceId = genId('ent')
    // P1-T4 (D9): entrances are stored building-local — convert the world click
    // before dispatching. Without a transformer we cannot anchor the position,
    // so the placement is refused (no world values are ever written).
    const local = transformer?.worldToBuildingLocal(formState.position!, targetBuilding.id)
    if (!local) return
    editEngine.begin({ kind: 'create', entityType: 'entrance', geometry: formState.position!, properties: { label: formState.label || '', buildingId: targetBuilding.id, floorId } })
    editEngine.doCommit()
    dispatcher.execute({
      id: 'entrance.create',
      label: 'Create Entrance',
      payload: {
        id: entranceId,
        buildingId: targetBuilding.id,
        floorId,
        position: local,
        level: formState.floor,
        label: formState.label || '',
        type: 'side',
        hasQR: true,
        hasPanorama: false,
      },
    })
    workflow.save('manual')

    setFormState(null)
  }, [formState, document.buildings, activeBuildingId, editEngine, dispatcher, workflow, transformer])

  const cancelPlacement = useCallback(() => {
    setFormState(null)
  }, [])

  return {
    active: tool === 'entrance',
    pending: formState,
    handleMapClick,
    confirmPlacement,
    cancelPlacement,
    setFormState,
  }
}
