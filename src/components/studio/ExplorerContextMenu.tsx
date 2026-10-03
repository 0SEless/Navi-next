'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface ContextMenuAction {
  id: string
  label: string
  icon?: ReactNode
  action: () => void
}

interface ExplorerContextMenuProps {
  actions: ContextMenuAction[]
  position: { x: number; y: number }
  onClose: () => void
}

export function ExplorerContextMenu({ actions, position, onClose }: ExplorerContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  const handleOutsideClick = (e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      onClose()
    }
  }

  useEffect(() => {
    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        style={{
          position: 'fixed', left: position.x, top: position.y,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 140,
          padding: '4px 0', zIndex: 1000,
        }}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => { action.action(); onClose() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '6px 12px', border: 'none',
              background: 'none', cursor: 'pointer', fontSize: 13,
              color: action.id === 'delete' ? '#dc2626' : '#374151',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
