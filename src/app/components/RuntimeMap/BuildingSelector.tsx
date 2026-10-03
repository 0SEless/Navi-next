'use client'

import type { BuildingEntry } from '@navi/compiler'

interface Props {
  buildings: BuildingEntry[]
  selected: string | null
  onSelect: (id: string | null) => void
}

export function BuildingSelector({ buildings, selected, onSelect }: Props) {
  return (
    <select
      value={selected ?? ''}
      onChange={e => onSelect(e.target.value || null)}
      style={{
        padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db',
        fontSize: 14, background: 'white', cursor: 'pointer',
      }}
    >
      <option value="">All buildings</option>
      {buildings.map(b => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  )
}
