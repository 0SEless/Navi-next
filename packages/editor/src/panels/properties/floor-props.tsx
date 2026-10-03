import { useCallback } from 'react'
import type { Floor } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, SectionHeader } from './field'

interface Props { floor: Floor }

export function FloorProperties({ floor }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: floor.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Floor', payload: { entityId: floor.id, changes } })
  }, [editEngine, dispatcher, floor.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Label">
        <input value={floor.label} onChange={e => update({ label: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Level">
        <input type="number" value={floor.level} disabled style={{ ...inputStyle, opacity: 0.5 }} />
      </Field>
      <Field label="Elevation (m)">
        <input type="number" value={floor.elevation}
          onChange={e => update({ elevation: parseFloat(e.target.value) || 0 })}
          style={inputStyle} />
      </Field>
    </div>
  )
}
