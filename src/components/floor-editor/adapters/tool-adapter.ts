'use client'

import { useSyncExternalStore } from 'react'
import type { CurrentToolStore } from '@navi/editor'
import type { StudioTool } from '@/types/studio-types'

const FLOOR_TOOL_IDS = new Set<string>(['select', 'space', 'entrance', 'stairs', 'staircase', 'elevator', 'poi', 'hallway', 'wall', 'door'])

function toStudioTool(id: string | null): StudioTool {
  if (id && FLOOR_TOOL_IDS.has(id)) return id as StudioTool
  return 'select'
}

export function useToolAdapter(toolStore: CurrentToolStore) {
  const activeTool = useSyncExternalStore(
    (cb) => toolStore.subscribe(cb),
    () => toStudioTool(toolStore.activeToolId),
  )

  return {
    activeTool,
    activateTool: (tool: StudioTool) => {
      toolStore.activate(tool)
    },
    isActive: (tool: StudioTool) => activeTool === tool,
  }
}
