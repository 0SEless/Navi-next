'use client'

import { useStudioStore } from '@/store/studio-store'

export function PositionEditHint() {
  const target = useStudioStore((s) => s.positionEditTarget)

  if (!target) return null

  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 20,
      background: '#0F172A',
      color: '#e2e8f0',
      padding: '8px 18px',
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 500,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      border: '1px solid #334155',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    }}>
      Drag to reposition &bull; Drag handle to rotate &bull; Press Esc to cancel
    </div>
  )
}
