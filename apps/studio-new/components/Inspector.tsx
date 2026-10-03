'use client'

/**
 * Stage 4.5 — Inspector Panel
 *
 * Dumb view — never mutates state directly, never calls CommandBus.
 * All edits flow through InspectorController → CommandBus → CampusDocument.
 *
 * Architectural rules:
 *   - NEVER modifies SelectionManager
 *   - NEVER modifies CampusDocument directly
 *   - NEVER calls MapLibre APIs
 *   - NEVER calls CommandBus directly
 *   - ALWAYS uses InspectorController for edits
 */

import { useState, useEffect, useCallback } from 'react'
import type { CampusDocument } from '@navi/core'
import { SelectionManager } from '../lib/selection/selection-manager'
import type { EntityRef } from '../lib/selection/selection-manager'
import { InspectorController } from '../lib/commands/inspector-controller'

interface InspectorProps {
  selectionManager: SelectionManager
  document: CampusDocument
  controller: InspectorController
  docVersion: number
}

interface EditableField {
  key: string
  label: string
  value: string
  kind: 'text' | 'number' | 'badge'
}

function getFields(doc: CampusDocument, entity: EntityRef): EditableField[] | null {
  switch (entity.type) {
    case 'building': {
      const b = doc.buildings.find(x => x.id === entity.id)
      if (!b) return null
      return [
        { key: 'name', label: 'Name', value: b.name, kind: 'text' },
        { key: 'code', label: 'Code', value: b.code, kind: 'text' },
        { key: 'category', label: 'Category', value: b.category, kind: 'text' },
        { key: 'height', label: 'Height', value: String(b.height ?? 10), kind: 'number' },
        { key: 'color', label: 'Color', value: b.color ?? '#1C6BEB', kind: 'badge' },
      ]
    }

    case 'road': {
      const r = doc.roads.find(x => x.id === entity.id)
      if (!r) return null
      return [
        { key: 'name', label: 'Name', value: r.name, kind: 'text' },
        { key: 'width', label: 'Width', value: String(r.width ?? 4), kind: 'number' },
        { key: 'surface', label: 'Surface', value: r.surface ?? 'unknown', kind: 'text' },
      ]
    }

    case 'room': {
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const r = f.rooms.find(x => x.id === entity.id)
          if (!r) continue
          return [
            { key: 'name', label: 'Name', value: r.name, kind: 'text' },
            { key: 'number', label: 'Number', value: r.number, kind: 'text' },
            { key: 'category', label: 'Category', value: r.category, kind: 'text' },
            { key: 'capacity', label: 'Capacity', value: r.capacity ? String(r.capacity) : '', kind: 'number' },
          ]
        }
      }
      return null
    }

    case 'hallway': {
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const h = f.hallways.find(x => x.id === entity.id)
          if (!h) continue
          return [
            { key: 'name', label: 'Name', value: h.name, kind: 'text' },
            { key: 'width', label: 'Width', value: String(h.width ?? 2), kind: 'number' },
          ]
        }
      }
      return null
    }

    case 'staircase': {
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const s = f.staircases.find(x => x.id === entity.id)
          if (!s) continue
          return [
            { key: 'name', label: 'Name', value: s.name, kind: 'text' },
            { key: 'fromLevel', label: 'From Level', value: String(s.fromLevel), kind: 'number' },
            { key: 'toLevel', label: 'To Level', value: String(s.toLevel), kind: 'number' },
            { key: 'type', label: 'Type', value: s.type, kind: 'text' },
          ]
        }
      }
      return null
    }

    case 'elevator': {
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const e = f.elevators.find(x => x.id === entity.id)
          if (!e) continue
          return [
            { key: 'name', label: 'Name', value: e.name, kind: 'text' },
            { key: 'fromLevel', label: 'From Level', value: String(e.fromLevel), kind: 'number' },
            { key: 'toLevel', label: 'To Level', value: String(e.toLevel), kind: 'number' },
          ]
        }
      }
      return null
    }

    case 'entrance': {
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const e = f.entrances.find(x => x.id === entity.id)
          if (!e) continue
          return [
            { key: 'label', label: 'Label', value: e.label, kind: 'text' },
            { key: 'level', label: 'Level', value: String(e.level), kind: 'number' },
            { key: 'type', label: 'Type', value: e.type, kind: 'text' },
          ]
        }
      }
      return null
    }

    case 'panorama': {
      const p = doc.panoramas.find(x => x.id === entity.id)
      if (!p) return null
      return [
        { key: 'label', label: 'Label', value: p.label, kind: 'text' },
        { key: 'heading', label: 'Heading', value: String(p.heading), kind: 'number' },
        { key: 'imageAssetId', label: 'Image Asset', value: p.imageAssetId, kind: 'text' },
      ]
    }

    case 'qr': {
      const q = doc.qrCheckpoints.find(x => x.id === entity.id)
      if (!q) return null
      return [
        { key: 'label', label: 'Label', value: q.label, kind: 'text' },
        { key: 'code', label: 'Code', value: q.code, kind: 'text' },
        { key: 'floor', label: 'Floor', value: String(q.floor), kind: 'number' },
      ]
    }

    default:
      return null
  }
}

export function Inspector({ selectionManager, document, controller, docVersion }: InspectorProps) {
  const [entity, setEntity] = useState<EntityRef | null>(selectionManager.selected)
  const fields = entity ? getFields(document, entity) : null

  useEffect(() => {
    const unsub = selectionManager.onChange((e) => {
      setEntity(e)
    })
    return unsub
  }, [selectionManager])

  const handleChange = useCallback(
    (key: string, value: string) => {
      if (!entity) return
      // Numbers → parse, strings → keep as-is
      const parsed = isNaN(Number(value)) || value === '' ? value : Number(value)
      controller.updateEntity(entity, { [key]: parsed })
    },
    [entity, controller],
  )

  const handleDelete = useCallback(() => {
    if (!entity) return
    controller.deleteEntity(entity)
    selectionManager.clear()
  }, [entity, controller, selectionManager])

  if (!entity || !fields) {
    const multiCount = selectionManager.count

    return (
      <div style={{
        width: 280, borderLeft: '1px solid #334155', background: '#0F172A',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <Header />
        <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: '#475569' }}>
          {multiCount > 1
            ? `${multiCount} entities selected`
            : 'Click an entity on the map to inspect it'
          }
        </div>
      </div>
    )
  }

  return (
    <div style={{
      width: 280, borderLeft: '1px solid #334155', background: '#0F172A',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto',
    }}>
      <Header />
      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Entity type + ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            padding: '2px 8px', borderRadius: 4,
            background: typeColor(entity.type), color: '#fff',
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {entity.type}
          </div>
          <div style={{ fontSize: 10, color: '#475569', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entity.id}
          </div>
        </div>

        {/* Editable fields — keyed by docVersion to reflect latest values */}
        <div key={docVersion} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((f) => (
            <EditableField
              key={f.key}
              field={f}
              onChange={handleChange}
            />
          ))}
        </div>

        {/* Delete button */}
        <button
          onClick={handleDelete}
          style={{
            marginTop: 8, padding: '8px 12px', borderRadius: 6,
            border: '1px solid #EF4444', background: 'transparent',
            color: '#EF4444', fontSize: 11, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div style={{
      padding: '12px 14px', borderBottom: '1px solid #334155',
      fontSize: 11, fontWeight: 600, color: '#94a3b8',
      textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      Inspector
    </div>
  )
}

function EditableField({
  field,
  onChange,
}: {
  field: EditableField
  onChange: (key: string, value: string) => void
}) {
  if (field.kind === 'badge') {
    return (
      <div>
        <Label text={field.label} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 14, height: 14, borderRadius: 3,
            background: field.value, display: 'inline-block',
            border: '1px solid #475569',
          }} />
          <span style={{
            padding: '5px 8px', borderRadius: 4, border: '1px solid #334155',
            background: '#1E293B', color: '#F1F5F9', fontSize: 12, flex: 1,
          }}>
            {field.value}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Label text={field.label} />
      <input
        defaultValue={field.value}
        onBlur={(e) => {
          if (e.target.value !== field.value) {
            onChange(field.key, e.target.value)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          }
        }}
        type={field.kind === 'number' ? 'number' : 'text'}
        style={{
          width: '100%', padding: '5px 8px', borderRadius: 4,
          border: '1px solid #334155', background: '#1E293B',
          color: '#F1F5F9', fontSize: 12, outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

function Label({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 9, color: '#64748B', marginBottom: 3,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {text}
    </div>
  )
}

function typeColor(type: string): string {
  switch (type) {
    case 'building': return '#4A90D9'
    case 'room': return '#87CEEB'
    case 'hallway': return '#B0C4DE'
    case 'road': return '#FFD700'
    case 'entrance': return '#FF8C00'
    case 'staircase': return '#20B2AA'
    case 'elevator': return '#9370DB'
    case 'panorama': return '#FF69B4'
    case 'qr': return '#32CD32'
    default: return '#64748B'
  }
}
