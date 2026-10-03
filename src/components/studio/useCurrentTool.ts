'use client'

import { useSyncExternalStore } from 'react'
import { useEditor } from '@navi/editor'
import type { CurrentToolStore } from '@navi/editor'

export function useCurrentTool(): string | null {
  const { services } = useEditor()
  const store = services.get('toolRegistry') as CurrentToolStore
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.activeToolId,
  )
}
