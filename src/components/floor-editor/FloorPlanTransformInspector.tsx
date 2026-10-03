'use client'

import { useMemo, useState } from 'react'
import type { PlanAlignment } from '@navi/core'
import {
  deriveFloorPlanInspectorValues,
  resetFloorPlanAlignment,
  updateAlignmentFromInspector,
  type FloorPlanInspectorField,
  type FloorPlanInspectorFrame,
} from '@/lib/floor-plan-inspector'
import { resolvePlanAlignment } from '@/lib/floor-plan-transform'

export interface FloorPlanTransformInspectorProps {
  frame: FloorPlanInspectorFrame
  alignment?: PlanAlignment | null
  onCommit: (alignment: PlanAlignment) => void
  aspectRatioLocked?: boolean
  onAspectRatioLockedChange?: (locked: boolean) => void
}

type Drafts = Partial<Record<FloorPlanInspectorField, string>>

const fieldLabels: Record<FloorPlanInspectorField, string> = {
  x: 'X (m)',
  y: 'Y (m)',
  width: 'Width (m)',
  height: 'Height (m)',
  rotation: 'Rotation (°)',
  opacity: 'Opacity (%)',
}

const numericFields: FloorPlanInspectorField[] = ['x', 'y', 'width', 'height', 'rotation', 'opacity']

export function FloorPlanTransformInspector({
  frame,
  alignment,
  onCommit,
  aspectRatioLocked: controlledAspectRatioLocked,
  onAspectRatioLockedChange,
}: FloorPlanTransformInspectorProps) {
  const [localAspectRatioLocked, setLocalAspectRatioLocked] = useState(true)
  const [draftState, setDraftState] = useState<{ key: string; values: Drafts }>({ key: '', values: {} })
  const values = useMemo(() => deriveFloorPlanInspectorValues(frame, alignment), [frame, alignment])
  const resolved = useMemo(() => resolvePlanAlignment(alignment), [alignment])
  const transformKey = useMemo(() => JSON.stringify({ frame, alignment }), [frame, alignment])
  const drafts = draftState.key === transformKey ? draftState.values : {}
  const aspectRatioLocked = controlledAspectRatioLocked ?? localAspectRatioLocked
  const transformLocked = resolved.locked

  const displayValue = (field: FloorPlanInspectorField): number => {
    if (field === 'opacity') return Math.round(values.opacity * 100)
    return values[field]
  }

  const commitField = (field: FloorPlanInspectorField) => {
    const raw = drafts[field]
    if (raw == null) return
    const value = Number(raw)
    setDraftState((current) => {
      const next = { ...current.values }
      delete next[field]
      return { key: transformKey, values: next }
    })
    if (!Number.isFinite(value)) return
    const next = updateAlignmentFromInspector(frame, alignment, {
      field,
      value,
      aspectRatioLocked,
    })
    if (next) onCommit(next)
  }

  const setAspectRatioLocked = (next: boolean) => {
    if (onAspectRatioLockedChange) onAspectRatioLockedChange(next)
    else setLocalAspectRatioLocked(next)
  }

  return (
    <section aria-label="Floor plan transform inspector" style={{ padding: '10px 12px', borderTop: '1px solid var(--navi-border)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Floor Plan Alignment
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {numericFields.map((field) => {
          const placementField = field !== 'opacity'
          const disabled = placementField && transformLocked
          const value = drafts[field] ?? displayValue(field)
          return (
            <label key={field} style={{ fontSize: 10, color: 'var(--navi-text-secondary)' }}>
              {fieldLabels[field]}
              <input
                aria-label={fieldLabels[field]}
                type="number"
                min={field === 'opacity' ? 0 : undefined}
                max={field === 'opacity' ? 100 : undefined}
                step={field === 'opacity' ? 1 : field === 'rotation' ? 0.5 : 0.1}
                value={value}
                disabled={disabled}
                onChange={(event) => setDraftState((current) => ({
                  key: transformKey,
                  values: { ...(current.key === transformKey ? current.values : {}), [field]: event.target.value },
                }))}
                onBlur={() => commitField(field)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitField(field)
                  }
                  if (event.key === 'Escape') {
                    setDraftState((current) => {
                      const next = { ...(current.key === transformKey ? current.values : {}) }
                      delete next[field]
                      return { key: transformKey, values: next }
                    })
                  }
                }}
                style={{ width: '100%', marginTop: 4, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11 }}
              />
            </label>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-pressed={aspectRatioLocked}
          aria-label="Lock floor plan aspect ratio"
          onClick={() => setAspectRatioLocked(!aspectRatioLocked)}
          style={{ padding: '4px 7px', borderRadius: 4, border: '1px solid var(--navi-border)', background: aspectRatioLocked ? '#DBEAFE' : 'var(--navi-content)', color: aspectRatioLocked ? '#1D4ED8' : 'var(--navi-text)', fontSize: 10 }}
        >
          {aspectRatioLocked ? 'Aspect Ratio Locked' : 'Aspect Ratio Free'}
        </button>
        <button
          type="button"
          aria-label="Fit to Building Bounds"
          disabled={transformLocked}
          onClick={() => onCommit(resetFloorPlanAlignment(alignment))}
          style={{ padding: '4px 7px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 10 }}
        >
          Fit to Building Bounds
        </button>
        <button
          type="button"
          aria-label={transformLocked ? 'Unlock Overlay' : 'Lock Overlay'}
          onClick={() => onCommit({ ...resolvePlanAlignment(alignment), locked: !transformLocked })}
          style={{ padding: '4px 7px', borderRadius: 4, border: '1px solid var(--navi-border)', background: transformLocked ? '#FEF3C7' : 'var(--navi-content)', color: transformLocked ? '#92400E' : 'var(--navi-text)', fontSize: 10 }}
        >
          {transformLocked ? 'Unlock Overlay' : 'Lock Overlay'}
        </button>
      </div>
    </section>
  )
}
