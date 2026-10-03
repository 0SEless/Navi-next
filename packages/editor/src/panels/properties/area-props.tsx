import { useCallback } from 'react'
import type { Area } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, SectionHeader } from './field'

interface Props { area: Area }

const AREA_COLORS = [
  '#FF6347', '#1C6BEB', '#22C55E', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#A855F7', '#64748B',
]

export function AreaProperties({ area }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: area.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Area', payload: { entityId: area.id, changes } })
  }, [editEngine, dispatcher, area.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Name">
        <input value={area.name} onChange={e => update({ name: e.target.value })} style={inputStyle} />
      </Field>

      <Field label="Color">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {AREA_COLORS.map(c => (
            <button key={c} title={c}
              onClick={() => update({ color: c })}
              style={{
                width: 20, height: 20, borderRadius: '50%', border: c === area.color ? '2px solid #fff' : '2px solid transparent',
                background: c, cursor: 'pointer', outline: c === area.color ? '2px solid #3B82F6' : 'none',
                padding: 0, boxSizing: 'border-box',
              }}
            />
          ))}
        </div>
      </Field>

      {area.points && area.points.length > 0 && (
        <>
          <SectionHeader>Points</SectionHeader>
          <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: tokens.fontSize.sm, color: tokens.textMuted }}>
            {area.points.map((pt, i) => (
              <div key={i} style={{ padding: '2px 0', borderBottom: `1px solid ${tokens.border}` }}>
                #{i + 1}: ({pt.lat.toFixed(6)}, {pt.lng.toFixed(6)})
              </div>
            ))}
          </div>
          <div style={{ marginTop: 4, fontSize: tokens.fontSize.sm, color: tokens.textMuted }}>
            {area.points.length} point{area.points.length !== 1 ? 's' : ''} &middot; {area.points.length >= 3 ? '✓ Closed polygon' : '⚠ Need 3+ points'}
          </div>
        </>
      )}
    </div>
  )
}
