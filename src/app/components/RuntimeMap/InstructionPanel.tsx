'use client'

import type { ReactNode } from 'react'
import type { Route } from '@navi/runtime'
import { Footprints, ArrowLeft, ArrowRight, Megaphone, ArrowUpFromLine, Flag, X } from 'lucide-react'

interface Props {
  route: Route | null
  onClose: () => void
}

const iconMap: Record<string, ReactNode> = {
  walk: <Footprints size={18} />,
  turn_left: <ArrowLeft size={18} />,
  turn_right: <ArrowRight size={18} />,
  stairs: <Megaphone size={18} />,
  elevator: <ArrowUpFromLine size={18} />,
  arrive: <Flag size={18} />,
}

export function InstructionPanel({ route, onClose }: Props) {
  if (!route) return null

  return (
    <div style={{
      position: 'absolute', top: 16, right: 16, width: 320,
      background: 'var(--navi-card)', color: 'var(--navi-text)', borderRadius: 12,
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      padding: 16, zIndex: 10, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong>{route.fromLabel} &rarr; {route.toLabel}</strong>
        <button onClick={onClose} aria-label="Close route instructions" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--navi-text-secondary)' }}>&times;</button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--navi-text-secondary)', marginBottom: 12 }}>
        {Math.round(route.totalDistance)}m &middot; {Math.round(route.totalDuration / 60)} min
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {route.instructions.map((inst, i) => (
          <li key={i} style={{
            display: 'flex', gap: 10, padding: '8px 0',
            borderBottom: i < route.instructions.length - 1 ? '1px solid var(--navi-border)' : 'none',
          }}>
            <span style={{ flexShrink: 0, display: 'inline-flex' }} aria-hidden="true">{iconMap[inst.type] ?? <Footprints size={18} />}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>{inst.text}</div>
              {inst.distance > 0 && (
                <div style={{ fontSize: 12, color: 'var(--navi-text-secondary)' }}>{Math.round(inst.distance)}m</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
