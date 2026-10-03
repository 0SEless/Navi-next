import { useCallback } from 'react'
import type { Entrance } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, selectStyle, ActionButton, SectionHeader } from './field'
import { useStudioStore } from '@/store/studio-store'

interface Props { entrance: Entrance }

export function EntranceProperties({ entrance }: Props) {
  const { services, document } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')
  const positionEditTarget = useStudioStore((s) => s.positionEditTarget)
  const setPositionEditTarget = useStudioStore((s) => s.setPositionEditTarget)
  const isAdjusting = positionEditTarget?.type === 'entrance' && positionEditTarget?.id === entrance.id

  const connectedRoad = entrance.connectorRoadId
    ? document.roads.find(r => r.id === entrance.connectorRoadId)
    : null

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: entrance.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Entrance', payload: { entityId: entrance.id, changes } })
  }, [editEngine, dispatcher, entrance.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Label">
        <input value={entrance.label} onChange={e => update({ label: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Type">
        <select value={entrance.type} onChange={e => update({ type: e.target.value })} style={selectStyle}>
          {['main','side','service','emergency'].map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="Has QR">
        <input type="checkbox" checked={entrance.hasQR}
          onChange={e => update({ hasQR: e.target.checked })}
          style={{ accentColor: tokens.accent, width: 16, height: 16, cursor: 'pointer' }} />
      </Field>
      <Field label="Has Panorama">
        <input type="checkbox" checked={entrance.hasPanorama}
          onChange={e => update({ hasPanorama: e.target.checked })}
          style={{ accentColor: tokens.accent, width: 16, height: 16, cursor: 'pointer' }} />
      </Field>

      <SectionHeader>Position</SectionHeader>
      {!isAdjusting ? (
        <ActionButton onClick={() => setPositionEditTarget({ type: 'entrance', id: entrance.id })}>
          Adjust on Map
        </ActionButton>
      ) : (
        <div style={{
          background: '#1A1A3A', border: `1px solid #3A3A6A`,
          borderRadius: tokens.radius.md, padding: 10,
        }}>
          <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, marginBottom: 10 }}>
            Drag the entrance marker on the map to adjust its position.
          </div>
          <ActionButton variant="success" style={{ textAlign: 'center' }}
            onClick={() => setPositionEditTarget(null)}>
            ✓ Done
          </ActionButton>
        </div>
      )}

      <SectionHeader>Road Connection</SectionHeader>
      {connectedRoad ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: tokens.radius.md,
          background: '#0F2A1A', border: '1px solid #1A4A2A',
        }}>
          <span style={{ color: '#4ADE80', fontSize: 14 }}>✓</span>
          <div>
            <div style={{ color: tokens.text, fontSize: tokens.fontSize.base, fontWeight: 500 }}>
              Connected
            </div>
            <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.sm }}>
              {connectedRoad.name || 'Unnamed Road'}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: tokens.radius.md,
          background: '#2A1A0F', border: '1px solid #4A3A1A',
        }}>
          <span style={{ color: '#FBBF24', fontSize: 14 }}>⚠</span>
          <div>
            <div style={{ color: tokens.text, fontSize: tokens.fontSize.base, fontWeight: 500 }}>
              Not Connected
            </div>
            <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.sm }}>
              No road assigned
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
