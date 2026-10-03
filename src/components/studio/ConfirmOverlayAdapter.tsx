'use client'

import { useEffect } from 'react'
import { useStudioStore } from '@/store/studio-store'
import type { DrawingSessionValue } from './useDrawingSession'

interface ConfirmOverlayAdapterProps {
  drawing: DrawingSessionValue
}

/**
 * Bridges the drawing session's pendingConfirm state to the legacy Zustand
 * store so that ConfirmOverlay (which reads from Zustand) can display the
 * confirm/cancel UI.
 *
 * Direction A: drawing.pendingConfirm → Zustand
 * Direction B: Zustand (cleared by ConfirmOverlay) → drawing.cancel()
 *
 * When ConfirmOverlay is migrated to consume DrawingSession directly,
 * this adapter can be deleted.
 */
export function ConfirmOverlayAdapter({ drawing }: ConfirmOverlayAdapterProps) {
  // Direction A: drawing session → Zustand
  useEffect(() => {
    const pc = drawing.pendingConfirm
    if (pc) {
      useStudioStore.getState().setPendingConfirm(pc.type as any, pc.points as any, pc.connections)
    }
  }, [drawing.pendingConfirm])

  // Bridge routeWidth from drawing context → Zustand
  useEffect(() => {
    useStudioStore.getState().setRouteWidth(drawing.routeWidth)
  }, [drawing.routeWidth])

  // Direction B: Zustand → drawing session (ConfirmOverlay cleared it)
  useEffect(() => {
    const unsub = useStudioStore.subscribe((state) => {
      if (!state.pendingConfirm && drawing.pendingConfirm) {
        drawing.cancel()
      }
    })
    return () => unsub()
  }, [drawing])

  return null
}
