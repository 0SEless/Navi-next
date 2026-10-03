'use client'

import { Trash2, Check, X } from 'lucide-react'
import { useCurrentTool } from './useCurrentTool'
import type { DrawingSessionValue } from './useDrawingSession'

type ConfirmableTool = 'route' | 'building' | 'boundary' | 'area' | 'import-osm' | 'set-boundary'

interface ConfirmBarProps {
  drawing: DrawingSessionValue
}

export function ConfirmBar({ drawing }: ConfirmBarProps) {
  const tool = useCurrentTool()

  // Only shown for drawing tools with points placed
  if (tool !== 'route' && tool !== 'building' && tool !== 'boundary' && tool !== 'area' && tool !== 'import-osm' && tool !== 'set-boundary') return null
  // Once the draft has been submitted to the shared confirmation overlay,
  // keep one authoritative confirmation surface visible.
  if (drawing.pendingConfirm) return null

  const { tracePoints, drawPoints, routeWidth, requestConfirm, cancel, undoLastPoint, undoLastDrawPoint, setRouteWidth } = drawing

  const isRoute = tool === 'route'
  const currentPoints = isRoute ? tracePoints : drawPoints

  // Don't show bar if no points placed
  if (currentPoints.length === 0) return null

  const toolLabel = isRoute
    ? 'Campus route'
    : tool === 'building'
      ? 'Building footprint'
      : tool === 'boundary' || tool === 'set-boundary'
        ? 'Campus boundary'
        : tool === 'import-osm'
          ? 'Import from OSM'
          : 'Area'
  const minPoints = isRoute ? 2 : 3
  const canConfirm = currentPoints.length >= minPoints
  const onUndo = isRoute ? undoLastPoint : undoLastDrawPoint

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 6, background: '#1E293B', borderRadius: 8, padding: '4px 6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10, alignItems: 'center',
    }}>
      <span style={{
        fontSize: 10, color: '#06B6D4',
        padding: '0 4px', fontWeight: 600, whiteSpace: 'nowrap',
      }}>
        {toolLabel}
      </span>
      <span style={{ fontSize: 10, color: '#94A3B8', padding: '0 4px' }}>
        {currentPoints.length} point{currentPoints.length !== 1 ? 's' : ''} (need {minPoints})
      </span>
      {isRoute && (
        <>
          <span style={{ fontSize: 10, color: '#94A3B8', padding: '0 2px' }}>Road Width</span>
          <button onClick={() => setRouteWidth(routeWidth - 1)}
            style={{
              width: 24, height: 24, borderRadius: 4, border: 'none',
              background: '#475569', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, lineHeight: 1,
            }}
          >−</button>
          <span style={{ fontSize: 10, color: '#06B6D4', fontWeight: 600, minWidth: 16, textAlign: 'center' }}>
            {routeWidth}
          </span>
          <button onClick={() => setRouteWidth(routeWidth + 1)}
            style={{
              width: 24, height: 24, borderRadius: 4, border: 'none',
              background: '#475569', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, lineHeight: 1,
            }}
          >+</button>
        </>
      )}
      <button onClick={onUndo} disabled={currentPoints.length < 1} aria-label="Undo"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderRadius: 6,
          border: 'none', background: currentPoints.length < 1 ? '#374151' : '#475569',
          color: currentPoints.length < 1 ? '#6B7280' : '#fff', fontSize: 11,
          cursor: currentPoints.length < 1 ? 'not-allowed' : 'pointer',
        }}
      >
        <Trash2 size={12} />
      </button>
      <button onClick={() => requestConfirm(tool as ConfirmableTool)} disabled={!canConfirm}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6,
          border: 'none', background: !canConfirm ? '#374151' : '#10B981',
          color: !canConfirm ? '#6B7280' : '#fff', fontSize: 11,
          cursor: !canConfirm ? 'not-allowed' : 'pointer',
        }}
      >
        <Check size={12} /> Confirm
      </button>
      <button onClick={cancel}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6,
          border: 'none', background: '#EF4444', color: '#fff', fontSize: 11, cursor: 'pointer',
        }}
      >
        <X size={12} /> Cancel
      </button>
    </div>
  )
}
