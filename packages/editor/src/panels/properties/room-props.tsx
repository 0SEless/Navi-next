import { useCallback } from 'react'
import type { Room } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, selectStyle, SectionHeader } from './field'

interface Props { room: Room }

export function RoomProperties({ room }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: room.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Room', payload: { entityId: room.id, changes } })
  }, [editEngine, dispatcher, room.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Name">
        <input value={room.name} onChange={e => update({ name: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Number">
        <input value={room.number} onChange={e => update({ number: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Category">
        <select value={room.category} onChange={e => update({ category: e.target.value })} style={selectStyle}>
          {['classroom','office','lab','restroom','stairwell','elevator_lobby','lobby','storage','meeting','auditorium','server','utility','other'].map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Capacity">
        <input type="number" value={room.capacity ?? ''}
          onChange={e => update({ capacity: e.target.value ? parseInt(e.target.value) : undefined })}
          style={inputStyle} />
      </Field>
      <div style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm, marginTop: 6 }}>
        Polygon: {room.polygon.points.length} vertices
      </div>
    </div>
  )
}
