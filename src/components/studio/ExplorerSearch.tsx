'use client'

import { Search, X } from 'lucide-react'

interface ExplorerSearchProps {
  value: string
  onChange: (value: string) => void
  matchCount: number
}

export function ExplorerSearch({ value, onChange, matchCount }: ExplorerSearchProps) {
  return (
    <div style={{ position: 'relative', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
      <Search size={14} style={{ position: 'absolute', left: 12, top: 14, color: '#9ca3af' }} />
      <input
        type="text"
        placeholder="Search entities..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '4px 8px 4px 28px',
          border: '1px solid #d1d5db', borderRadius: 4,
          fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
        aria-label="Search entities"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            position: 'absolute', right: 12, top: 14,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1,
          }}
          aria-label="Clear search"
        >
          <X size={14} color="#9ca3af" />
        </button>
      )}
      {matchCount > 0 && (
        <span style={{
          position: 'absolute', right: value ? 28 : 12, top: 11,
          fontSize: 11, color: '#6b7280', background: '#f3f4f6',
          padding: '1px 6px', borderRadius: 8,
        }}>
          {matchCount}
        </span>
      )}
    </div>
  )
}
