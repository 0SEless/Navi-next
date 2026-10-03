'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { CaptureMarkerDraft, CaptureMarkerType } from '../types'

const markerTypes: Array<{ value: CaptureMarkerType; label: string; color: string }> = [
  { value: 'poi', label: 'POI', color: 'var(--navi-primary)' },
  { value: 'panorama', label: 'Panorama', color: 'var(--navi-accent)' },
  { value: 'entrance', label: 'Entrance', color: 'var(--navi-success)' },
  { value: 'hazard', label: 'Hazard', color: 'var(--navi-error)' },
]

export function MarkerSheet({ position, accuracy, onCancel, onSave }: {
  position: { latitude: number; longitude: number }
  accuracy: number | null | undefined
  onCancel: () => void
  onSave: (draft: CaptureMarkerDraft) => void | Promise<void>
}) {
  const [type, setType] = useState<CaptureMarkerType>('poi')
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="marker-sheet-title" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 4, padding: 16, border: '1px solid var(--navi-border)', borderRadius: 14, background: 'var(--navi-card)', boxShadow: '0 12px 36px rgba(15,23,42,0.24)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <h2 id="marker-sheet-title" style={{ margin: 0, color: 'var(--navi-text)', fontSize: 17 }}>Drop a marker</h2>
          <p style={{ margin: '3px 0 0', color: 'var(--navi-text-secondary)', fontSize: 12 }}>
            {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}{accuracy ? ` · ±${Math.round(accuracy)} m` : ''}
          </p>
        </div>
        <button type="button" aria-label="Close marker sheet" onClick={onCancel} style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--navi-border)', borderRadius: 8, color: 'var(--navi-text-secondary)', background: 'var(--navi-card)', cursor: 'pointer' }}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, margin: '14px 0' }}>
        {markerTypes.map((markerType) => (
          <button key={markerType.value} type="button" onClick={() => setType(markerType.value)} style={{ minHeight: 44, border: type === markerType.value ? `2px solid ${markerType.color}` : '1px solid var(--navi-border)', borderRadius: 8, color: type === markerType.value ? markerType.color : 'var(--navi-text-secondary)', background: 'var(--navi-card)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {markerType.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4, color: 'var(--navi-text-secondary)', fontSize: 12 }}>
          Label
          <input aria-label="Marker label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Optional name" style={{ minHeight: 44, border: '1px solid var(--navi-border)', borderRadius: 8, padding: '0 10px', color: 'var(--navi-text)', background: 'var(--navi-card)' }} />
        </label>
        <label style={{ display: 'grid', gap: 4, color: 'var(--navi-text-secondary)', fontSize: 12 }}>
          Note
          <textarea aria-label="Marker note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional field note" rows={2} style={{ border: '1px solid var(--navi-border)', borderRadius: 8, padding: 10, resize: 'vertical', color: 'var(--navi-text)', background: 'var(--navi-card)' }} />
        </label>
        <button type="button" onClick={() => void onSave({ type, label: label.trim() || undefined, note: note.trim() || undefined })} style={{ minHeight: 44, border: 0, borderRadius: 8, color: '#fff', background: 'var(--navi-primary)', fontWeight: 700, cursor: 'pointer' }}>Save marker</button>
      </div>
    </div>
  )
}
