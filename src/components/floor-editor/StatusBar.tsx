'use client'

import { useInteraction } from './InteractionContext'

/**
 * StatusBar displays contextual messages during interaction modes.
 * Shows status bar message when in RelationshipSelection mode.
 */
export function StatusBar() {
  const { statusMessage, state } = useInteraction()

  if (state.mode === 'idle' || !statusMessage) {
    return null
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#1E293B',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 11,
        color: '#E2E8F0',
        zIndex: 50,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      <span style={{ color: '#60A5FA', marginRight: 6 }}>ℹ</span>
      {statusMessage}
    </div>
  )
}
