'use client'

import type { DrawingSessionValue } from './useDrawingSession'

/**
 * Fix 1 — compact, non-modal Connect / Keep Separate choice.
 *
 * Shown only while a destination within the 0.5 m discovery radius is pending.
 * No modal; no geometry mutation happens until the admin picks an action.
 * Alt remains a keyboard shortcut for Keep Separate.
 */
export function ConnectionChoice({ drawing }: { drawing: DrawingSessionValue }) {
  const pending = drawing.pendingRoadConnection
  if (!pending) return null

  const label = pending.candidate.label

  return (
    <div
      role="group"
      aria-label="Road connection decision"
      style={{
        position: 'absolute', bottom: 62, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 6,
        background: '#1E293B', borderRadius: 8, padding: '5px 8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.35)', zIndex: 30,
      }}
    >
      <span style={{ fontSize: 10, color: '#E2E8F0', fontWeight: 600, whiteSpace: 'nowrap' }}>
        Connect to {label}?
      </span>
      <button
        onClick={() => drawing.resolveRoadConnection('connect')}
        style={{
          padding: '5px 10px', borderRadius: 6, border: 'none', background: '#10B981',
          color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}
      >
        Connect
      </button>
      <button
        onClick={() => drawing.resolveRoadConnection('separate')}
        style={{
          padding: '5px 10px', borderRadius: 6, border: 'none', background: '#475569',
          color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Keep Separate
      </button>
      <span style={{ fontSize: 9, color: '#94A3B8', whiteSpace: 'nowrap' }}>Alt = Keep Separate</span>
    </div>
  )
}
