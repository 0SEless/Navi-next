'use client'

import { useMemo } from 'react'
import type { Diagnostic, DiagnosticSeverity } from '@/diagnostics/diagnostic-types'

const SEVERITY_ORDER: DiagnosticSeverity[] = ['error', 'warning', 'info']

const SEVERITY_STYLES: Record<DiagnosticSeverity, string> = {
  error: 'border-l-red-500 bg-red-50',
  warning: 'border-l-yellow-500 bg-yellow-50',
  info: 'border-l-blue-500 bg-blue-50',
}

const SEVERITY_LABELS: Record<DiagnosticSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
}

interface DiagnosticsPanelProps {
  diagnostics: Diagnostic[]
  onSelect?: (diagnostic: Diagnostic) => void
}

export function DiagnosticsPanel({ diagnostics, onSelect }: DiagnosticsPanelProps) {
  const grouped = useMemo(() => {
    const sorted = [...diagnostics].sort((a, b) => {
      const aIdx = SEVERITY_ORDER.indexOf(a.severity)
      const bIdx = SEVERITY_ORDER.indexOf(b.severity)
      if (aIdx !== bIdx) return aIdx - bIdx
      return a.code.localeCompare(b.code)
    })
    return {
      errors: sorted.filter(d => d.severity === 'error'),
      warnings: sorted.filter(d => d.severity === 'warning'),
      info: sorted.filter(d => d.severity === 'info'),
      total: sorted,
    }
  }, [diagnostics])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <span className="font-semibold text-sm">Diagnostics</span>
        <span className="flex gap-2 text-xs">
          {grouped.errors.length > 0 && (
            <span className="text-red-600">{grouped.errors.length} err</span>
          )}
          {grouped.warnings.length > 0 && (
            <span className="text-yellow-600">{grouped.warnings.length} warn</span>
          )}
          {grouped.info.length > 0 && (
            <span className="text-blue-600">{grouped.info.length} info</span>
          )}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {grouped.total.map(d => (
          <div
            key={d.id}
            className={`border-l-4 px-3 py-2 cursor-pointer text-sm hover:opacity-80 ${SEVERITY_STYLES[d.severity]}`}
            onClick={() => onSelect?.(d)}
            role="button"
            tabIndex={0}
          >
            <div className="font-medium">
              <span className="text-xs uppercase text-gray-500 mr-1">{SEVERITY_LABELS[d.severity]}</span>
              {d.title}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">{d.message}</div>
          </div>
        ))}
        {grouped.total.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            No issues found
          </div>
        )}
      </div>
    </div>
  )
}
