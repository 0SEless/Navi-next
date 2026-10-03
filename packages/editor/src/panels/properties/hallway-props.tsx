import { useCallback } from 'react'
import type { Hallway } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, SectionHeader } from './field'

interface Props { hallway: Hallway }

export function HallwayProperties({ hallway }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: hallway.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Hallway', payload: { entityId: hallway.id, changes } })
  }, [editEngine, dispatcher, hallway.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Name">
        <input value={hallway.name} onChange={e => update({ name: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Width (m)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="range" min={1} max={10} step={0.5}
            value={hallway.width}
            onChange={e => update({ width: parseFloat(e.target.value) })}
            style={{ width: 120, accentColor: tokens.accent }} />
          <span style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>{hallway.width}m</span>
        </div>
      </Field>
      <Field label="Color">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="color" value={hallway.color || '#B0C4DE'}
            onChange={e => update({ color: e.target.value })}
            style={{
              width: 36, height: 28, padding: 1, border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radius.sm, cursor: 'pointer', background: 'transparent',
            }} />
        </div>
      </Field>
    </div>
  )
}
