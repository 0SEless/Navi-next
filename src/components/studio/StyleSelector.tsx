'use client'

import { useStudioStore } from '@/store/studio-store'
import type { BaseStyleKey } from '@/types/studio-types'
import { BASE_STYLE_NAMES } from './rendering/styles'

export function StyleSelector() {
  const baseStyle = useStudioStore((s) => s.baseStyle)
  const setBaseStyle = useStudioStore((s) => s.setBaseStyle)

  return (
    <select
      value={baseStyle}
      onChange={(e) => setBaseStyle(e.target.value as BaseStyleKey)}
      style={{
        padding: '5px 8px',
        borderRadius: 6,
        border: '1px solid var(--navi-border)',
        background: 'var(--navi-card)',
        color: 'var(--navi-text)',
        fontSize: 11,
        fontWeight: 500,
        cursor: 'pointer',
        outline: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      }}
    >
      {(Object.keys(BASE_STYLE_NAMES) as BaseStyleKey[]).map((key) => (
        <option key={key} value={key}>{BASE_STYLE_NAMES[key]}</option>
      ))}
    </select>
  )
}
