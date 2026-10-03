import { useCallback } from 'react'
import type { LegacyElevator } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, SectionHeader } from './field'

interface Props { elevator: LegacyElevator }

export function ElevatorProperties({ elevator }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: elevator.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Elevator', payload: { entityId: elevator.id, changes } })
  }, [editEngine, dispatcher, elevator.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Name">
        <input value={elevator.name} onChange={e => update({ name: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="From Level">
        <input type="number" value={elevator.fromLevel}
          onChange={e => update({ fromLevel: parseInt(e.target.value) || 0 })}
          style={inputStyle} />
      </Field>
      <Field label="To Level">
        <input type="number" value={elevator.toLevel}
          onChange={e => update({ toLevel: parseInt(e.target.value) || 0 })}
          style={inputStyle} />
      </Field>
    </div>
  )
}
