'use client'

import { useEffect } from 'react'
import { useEditor } from '@navi/editor'

export function useToolController() {
  const { services } = useEditor()
  const eventBus = services.get('eventBus')
  const dispatcher = services.get('dispatcher')

  useEffect(() => {
    if (!eventBus || !dispatcher) return

    const handleEvent = (payload: Record<string, unknown>) => {
      if (!payload?.command) return
      dispatcher.execute(
        { id: payload.command as string, label: payload.command as string, payload: (payload.payload ?? {}) as Record<string, unknown> },
        {},
      )
    }

    const unsubscribe = eventBus.on('tool.changed', handleEvent)
    return () => unsubscribe()
  }, [eventBus, dispatcher])
}
