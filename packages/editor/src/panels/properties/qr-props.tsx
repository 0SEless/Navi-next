import { useCallback } from 'react'
import type { QRCheckpoint } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, ActionButton, SectionHeader } from './field'
import { useStudioStore } from '@/store/studio-store'

interface Props { qr: QRCheckpoint }

export function QRProperties({ qr }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')
  const positionEditTarget = useStudioStore((s) => s.positionEditTarget)
  const setPositionEditTarget = useStudioStore((s) => s.setPositionEditTarget)
  const isAdjusting = positionEditTarget?.type === 'qr' && positionEditTarget?.id === qr.id

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: qr.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit QR', payload: { entityId: qr.id, changes } })
  }, [editEngine, dispatcher, qr.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Label">
        <input value={qr.label} onChange={e => update({ label: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Code">
        <input value={qr.code} onChange={e => update({ code: e.target.value })} style={inputStyle} />
      </Field>

      <SectionHeader>Position</SectionHeader>
      {!isAdjusting ? (
        <ActionButton onClick={() => setPositionEditTarget({ type: 'qr', id: qr.id })}>
          Adjust on Map
        </ActionButton>
      ) : (
        <div style={{
          background: '#1A1A3A', border: `1px solid #3A3A6A`,
          borderRadius: tokens.radius.md, padding: 10,
        }}>
          <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, marginBottom: 10 }}>
            Drag the QR marker on the map to adjust its position.
          </div>
          <ActionButton variant="success" style={{ textAlign: 'center' }}
            onClick={() => setPositionEditTarget(null)}>
            ✓ Done
          </ActionButton>
        </div>
      )}
    </div>
  )
}
