'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Building } from '@/types/nav-types'

export const COLOR_SWATCHES = [
  '#1C6BEB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316',
  '#6366F1', '#84CC16', '#0EA5E9', '#D946EF', '#FB923C',
]

export const INPUT_STYLE: React.CSSProperties = {
  padding: '5px 8px', borderRadius: 4, border: '1px solid var(--navi-border)',
  background: 'var(--navi-card)', color: 'var(--navi-text)', fontSize: 12, outline: 'none', width: '100%',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}

function StepBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navi-text)', fontSize: 14 }}>
      {children}
    </button>
  )
}

export function BuildingMetadataForm({ building, onUpdate, onDelete }: {
  building: Building
  onUpdate: (partial: Partial<Building>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(building.name)
  const [height, setHeight] = useState(building.height)
  const [floors, setFloors] = useState(building.floors.length)
  const [color, setColor] = useState(building.color || '#1C6BEB')

  const handleSave = () => {
    onUpdate({ name, height, floors: Array.from({ length: floors }, (_, i) => i), color })
  }

  return (
    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="NAME">
        <input value={name} onChange={(e) => setName(e.target.value)}
          style={INPUT_STYLE} />
      </Field>

      <Field label="HEIGHT">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StepBtn onClick={() => setHeight(Math.max(1, height - 1))}>-</StepBtn>
          <input value={height} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setHeight(v) }}
            style={{ ...INPUT_STYLE, width: 44, textAlign: 'center' }} />
          <span style={{ fontSize: 10, color: 'var(--navi-text-secondary)' }}>m</span>
          <StepBtn onClick={() => setHeight(height + 1)}>+</StepBtn>
        </div>
      </Field>

      <Field label="FLOORS">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StepBtn onClick={() => setFloors(Math.max(1, floors - 1))}>-</StepBtn>
          <input value={floors} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setFloors(v) }}
            style={{ ...INPUT_STYLE, width: 44, textAlign: 'center' }} />
          <StepBtn onClick={() => setFloors(floors + 1)}>+</StepBtn>
        </div>
      </Field>

      <Field label="COLOR">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {COLOR_SWATCHES.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 24, height: 24, borderRadius: 4, background: c, border: color === c ? '2px solid var(--navi-text)' : '1px solid var(--navi-border)', cursor: 'pointer' }} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
            style={{ width: 24, height: 24, padding: 0, border: '1px solid var(--navi-border)', borderRadius: 4, cursor: 'pointer', background: 'none' }} />
        </div>
      </Field>

      <Field label="ID">
        <div style={{ fontSize: 10, color: 'var(--navi-text-secondary)', wordBreak: 'break-all' }}>{building.id}</div>
      </Field>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={handleSave}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', background: 'var(--navi-primary)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Save Changes
        </button>
        <button onClick={onDelete}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 6, border: '1px solid #EF4444', background: 'transparent', color: '#EF4444', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  )
}
