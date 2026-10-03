'use client'

import { useState, useEffect } from 'react'
import { Check, X, AlertCircle, Info } from 'lucide-react'

export interface ImportToastData {
  message: string
  type: 'success' | 'error' | 'info'
}

let _globalSetToast: ((data: ImportToastData | null) => void) | null = null
let _globalTimer: ReturnType<typeof setTimeout> | null = null

/** Call from anywhere to show a brief toast notification. */
export function showImportToast(data: ImportToastData): void {
  if (_globalTimer) clearTimeout(_globalTimer)
  _globalSetToast?.(data)
  _globalTimer = setTimeout(() => {
    _globalSetToast?.(null)
    _globalTimer = null
  }, 3000)
}

export function ImportToast() {
  const [toast, setToast] = useState<ImportToastData | null>(null)

  useEffect(() => {
    _globalSetToast = setToast
    return () => {
      _globalSetToast = null
      if (_globalTimer) clearTimeout(_globalTimer)
    }
  }, [])

  if (!toast) return null

  const isSuccess = toast.type === 'success'
  const isInfo = toast.type === 'info'
  const borderColor = isSuccess ? '#10B981' : isInfo ? '#0EA5E9' : '#EF4444'
  const background = isSuccess ? '#F0FDF4' : isInfo ? '#F0F9FF' : '#FEF2F2'
  const color = isSuccess ? '#065F46' : isInfo ? '#0C4A6E' : '#991B1B'

  return (
    <div style={{
      position: 'absolute', top: 12, right: 12, zIndex: 20,
      padding: '8px 14px',
      borderRadius: 8,
      border: '1px solid',
      borderColor,
      background,
      color,
      fontSize: 12,
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      pointerEvents: 'auto',
      animation: 'fadeIn 0.2s ease-out',
    }}>
      {isSuccess ? <Check size={14} /> : isInfo ? <Info size={14} /> : <AlertCircle size={14} />}
      <span>{toast.message}</span>
      <button
        onClick={() => setToast(null)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, display: 'flex', color: 'inherit', opacity: 0.6,
        }}
      >
        <X size={12} />
      </button>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}
