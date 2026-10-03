'use client'

import { X } from 'lucide-react'
import { useStudioStore } from '@/store/studio-store'
import { useFloorCount, useActiveBuilding } from '@navi/editor'

const FLOOR_LABELS = ['GF', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', 'B1', 'B2', 'B3']

export function FloorTabs() {
  const activeFloor = useStudioStore((s) => s.activeFloor)
  const setActiveFloor = useStudioStore((s) => s.setActiveFloor)
  const setEditorMode = useStudioStore((s) => s.setEditorMode)
  const floorCount = useFloorCount()
  const activeBuilding = useActiveBuilding()
  const activeBuildingId = activeBuilding?.id ?? null
  const floors = Array.from({ length: Math.max(floorCount, 1) }, (_, i) => ({
    value: i,
    label: FLOOR_LABELS[i] ?? `${i}F`,
  }))

  return (
    <div style={{
      background: 'var(--navi-card)', borderBottom: '1px solid var(--navi-border)',
      padding: '4px 14px', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>
      <span style={{ color: 'var(--navi-text-secondary)', fontSize: 10, fontWeight: 600, marginRight: 8 }}>
        FLOOR EDITOR{activeBuildingId ? ` — ${activeBuilding?.name ?? activeBuildingId.slice(0, 8)}` : ''}
      </span>
      {floors.map((f) => (
        <button key={f.value} onClick={() => setActiveFloor(f.value)}
          style={{
            padding: '4px 12px', borderRadius: 4, border: 'none',
            background: activeFloor === f.value ? 'var(--navi-primary)' : 'transparent',
            color: activeFloor === f.value ? 'white' : 'var(--navi-text-secondary)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >{f.label}</button>
      ))}
      <div style={{ flex: 1 }} />
      <button onClick={() => setEditorMode('campus')}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 4, border: '1px solid var(--navi-border)',
          background: 'transparent', color: 'var(--navi-text-secondary)',
          fontSize: 11, cursor: 'pointer',
        }}
      ><X size={12} /> Exit Floor Edit</button>
    </div>
  )
}
