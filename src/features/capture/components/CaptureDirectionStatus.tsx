'use client'

import { Compass } from 'lucide-react'
import type { CaptureDirectionResolution } from '../direction'

export interface CaptureDirectionStatusProps {
  direction: CaptureDirectionResolution
  canRequestPermission: boolean
  onEnable: () => void | Promise<void>
}

function directionLabel(direction: CaptureDirectionResolution): string {
  switch (direction.status) {
    case 'available':
      return 'Facing direction · Device'
    case 'permission-required':
      return 'Facing direction permission needed'
    case 'denied':
      return 'Facing direction unavailable · Permission denied'
    case 'unsupported':
      return 'Facing direction unavailable · Not supported'
    case 'unreliable':
      return 'Facing direction unavailable · Unreliable'
    case 'gps-fallback':
      return 'Movement direction · GPS'
    case 'location-only':
      return 'Location only'
  }
}

function statusColor(status: CaptureDirectionResolution['status']): string {
  if (status === 'available') return '#86efac'
  if (status === 'gps-fallback') return '#bfdbfe'
  if (status === 'permission-required') return '#fde68a'
  if (status === 'denied' || status === 'unsupported' || status === 'unreliable') return '#fca5a5'
  return 'rgba(255,255,255,0.7)'
}

export function CaptureDirectionStatus({ direction, canRequestPermission, onEnable }: CaptureDirectionStatusProps) {
  return (
    <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, color: statusColor(direction.status), fontSize: 10, lineHeight: 1.2 }}>
      <Compass size={13} aria-hidden="true" />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{directionLabel(direction)}</span>
      {direction.status === 'permission-required' && canRequestPermission && (
        <button
          type="button"
          onClick={() => { void onEnable() }}
          style={{ flex: '0 0 auto', minHeight: 32, padding: '4px 8px', border: '1px solid rgba(253,230,138,0.5)', borderRadius: 6, color: '#0f172a', background: '#fde68a', fontSize: 10, fontWeight: 750, cursor: 'pointer', pointerEvents: 'auto', touchAction: 'manipulation' }}
        >
          Enable direction
        </button>
      )}
    </div>
  )
}
