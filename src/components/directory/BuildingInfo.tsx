'use client'

import { X } from 'lucide-react'
import { useGraphStore } from '@/store/graph-store'
import type { Building, NavNode } from '@/types/nav-types'

interface BuildingInfoProps {
  building: Building | null
  onClose: () => void
}

export function BuildingInfo({ building, onClose }: BuildingInfoProps) {
  const graph = useGraphStore((s) => s.graph)

  if (!building) return null

  const nodes: NavNode[] = graph.nodes.filter(
    (n) => n.buildingId === building.id
  )

  return (
    <div style={{
      padding: 12,
      background: 'var(--navi-card)',
      borderTop: '1px solid var(--navi-border)',
      maxHeight: 200,
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--navi-text)' }}>{building.name}</div>
          <div style={{ fontSize: 10, color: 'var(--navi-text-secondary)' }}>
            {building.floors.length > 1
              ? `Floors ${Math.min(...building.floors)}\u2013${Math.max(...building.floors)}`
              : `Floor ${building.floors[0]}`}
          </div>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--navi-text-secondary)', cursor: 'pointer', padding: 4 }}>
          <X size={16} />
        </button>
      </div>
      {nodes.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--navi-text)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--navi-text-secondary)' }}>POINTS OF INTEREST</div>
          {nodes.map((n) => (
            <div key={n.id} style={{ padding: '2px 0', display: 'flex', gap: 6 }}>
              <span style={{ color: 'var(--navi-text-secondary)', minWidth: 10 }}>{'\u2022'}</span>
              <span style={{ flex: 1 }}>{n.label || n.id}</span>
              <span style={{ color: 'var(--navi-text-secondary)' }}>{n.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
