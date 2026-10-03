'use client'

import { MousePointer2, Square, Minus, Maximize, ArrowUpDown } from 'lucide-react'
import { useStudioStore } from '@/store/studio-store'
import type { StudioTool } from '@/types/studio-types'

const COMPONENTS: { tool: StudioTool; icon: typeof MousePointer2; label: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select' },
  { tool: 'room', icon: Square, label: 'Room' },
  { tool: 'wall', icon: Minus, label: 'Wall' },
  { tool: 'door', icon: Maximize, label: 'Door' },
  { tool: 'stairs', icon: ArrowUpDown, label: 'Stairs' },
]

export function ComponentPalette() {
  const tool = useStudioStore((s) => s.tool)
  const setTool = useStudioStore((s) => s.setTool)

  return (
    <div style={{
      width: 44, background: 'var(--navi-card)',
      borderRight: '1px solid var(--navi-border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '6px 0', gap: 2, flexShrink: 0,
    }}>
      {COMPONENTS.map(({ tool: t, icon: Icon, label }) => (
        <button key={t} title={label} onClick={() => setTool(t)}
          style={{
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, border: 'none',
            background: tool === t ? 'var(--navi-primary)' : 'transparent',
            color: tool === t ? 'white' : 'var(--navi-text-secondary)',
            cursor: 'pointer',
          }}
        ><Icon size={15} /></button>
      ))}
    </div>
  )
}
