'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QrCode, ScanLine, X } from 'lucide-react'
import { QRScanner } from '@/components/map/QRScanner'
import { QR_DEFAULT_CAMPUS } from '@/lib/qr-payload'
import { resolveQrScanPayload, type QrLocation } from '@/lib/qr-location'
import { usePublicStore } from '@/store/public-store'

interface QRScanSheetProps {
  open: boolean
  onClose: () => void
  onResolved: (location: QrLocation, mode: 'start' | 'destination') => void
}

export type ScanMode = 'start' | 'destination'

/**
 * Scan a NAVI location code: camera via QRScanner, plus a manual entry
 * field (works in desktop demos and when the camera is unavailable).
 * Camera and manual input share the same published QR/legacy resolver.
 */
export function QRScanSheet({ open, onClose, onResolved }: QRScanSheetProps) {
  // NOTE: select a stable reference only — a selector like
  // `(s) => s.campus?.nodes ?? []` returns a NEW array while campus
  // is null and trips zustand's "getSnapshot should be cached" loop.
  const campus = usePublicStore((s) => s.campus)
  // Campus id the store loaded (falls back to the protocol default while
  // the campus is still loading). Primitive selector — never a new
  // reference, so it cannot trip zustand's snapshot-caching loop.
  const currentCampusId =
    usePublicStore((s) => s.currentCampusId ?? s.campusData?.campusId) ?? QR_DEFAULT_CAMPUS
  const [mode, setMode] = useState<ScanMode>('start')
  const [manual, setManual] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Ref-sync (ERRORS.md 2026-07-23): QRScanner re-initializes the camera
  // whenever its onScan/onError handlers change identity, so handlePayload
  // must stay referentially stable (deps []) and read live values via refs.
  const campusRef = useRef(campus)
  const modeRef = useRef(mode)
  const campusIdRef = useRef(currentCampusId)
  const onResolvedRef = useRef(onResolved)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    campusRef.current = campus
    modeRef.current = mode
    campusIdRef.current = currentCampusId
    onResolvedRef.current = onResolved
    onCloseRef.current = onClose
  }, [campus, mode, currentCampusId, onResolved, onClose])

  const handlePayload = useCallback((payload: string) => {
    const resolved = resolveQrScanPayload(
      payload,
      campusRef.current,
      campusIdRef.current,
    )
    if (resolved.status !== 'resolved') {
      const message = resolved.status === 'foreign'
        ? 'This NAVI code belongs to another campus'
        : resolved.status === 'unknown'
          ? `Unknown QR location (${resolved.reference})`
          : resolved.status === 'unavailable'
            ? 'QR location is unavailable until published campus data is loaded'
            : 'QR code could not be resolved'
      setError(message)
      return
    }
    setError(null)
    onResolvedRef.current(resolved.location, modeRef.current)
    onCloseRef.current()
  }, [])

  const cameraError = useCallback((msg: string) => {
    setError(`Camera unavailable — paste the code below instead. (${msg})`)
  }, [])

  const sheet = useMemo(() => {
    if (!open) return null
    return (
      <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Scan NAVI code">
        <div className="w-full max-w-md rounded-t-2xl bg-[var(--navi-card)] p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--navi-text)]">
              <ScanLine className="h-4 w-4 text-[var(--navi-primary)]" />
              Scan a NAVI code
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--navi-text-secondary)] hover:bg-[var(--navi-border)]/50"
              aria-label="Close scanner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Use-as toggle */}
          <div className="mb-3 flex gap-2">
            {(['start', 'destination'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`min-h-11 flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-[var(--navi-primary)] text-white'
                    : 'bg-[var(--navi-content)] text-[var(--navi-text-secondary)]'
                }`}
                aria-pressed={mode === m}
              >
                Use as {m === 'start' ? 'start point' : 'destination'}
              </button>
            ))}
          </div>

          {/* Camera view (only rendered while open) */}
          <div className="overflow-hidden rounded-xl bg-black">
            <QRScanner onPayload={handlePayload} onError={cameraError} />
          </div>

          {/* Manual entry fallback */}
          <div className="mt-3">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--navi-text-secondary)]">
              <QrCode className="h-3 w-3" />
              Or paste a code
            </div>
            <div className="flex gap-2">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manual.trim()) handlePayload(manual.trim())
                }}
                placeholder="navi://asu-ibajay/navigate?node=node-1"
                aria-label="Paste NAVI code"
                className="min-h-11 min-w-0 flex-1 rounded-lg bg-[var(--navi-content)] px-3 py-2 text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => manual.trim() && handlePayload(manual.trim())}
                disabled={!manual.trim()}
                className="min-h-11 rounded-lg bg-[var(--navi-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Use
              </button>
            </div>
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-600" role="alert" aria-live="assertive">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }, [open, mode, manual, error, handlePayload, cameraError, onClose])

  return sheet
}
