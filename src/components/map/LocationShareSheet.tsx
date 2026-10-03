'use client'

import { useEffect, useState } from 'react'
import { Copy, Link2, Share2, X } from 'lucide-react'
import { encodeQrPayload } from '@/lib/qr-payload'

interface LocationShareSheetProps {
  open: boolean
  campusId: string
  nodeId: string
  label: string
  sublabel?: string
  onClose: () => void
}

/**
 * Share a location as a NAVI code: renders a scannable QR (qrcode pkg)
 * plus the raw payload with copy-to-clipboard. Scanning the code on
 * another device resolves to this exact routable node.
 */
export function LocationShareSheet({
  open,
  campusId,
  nodeId,
  label,
  sublabel,
  onClose,
}: LocationShareSheetProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const payload = encodeQrPayload(campusId, nodeId)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setQrDataUrl(null)
    setCopied(false)
    void import('qrcode').then((QRCode) =>
      QRCode.default.toDataURL(payload, { width: 240, margin: 1, color: { dark: '#0f172a' } }),
    ).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    }).catch(() => {
      if (!cancelled) setQrDataUrl(null)
    })
    return () => {
      cancelled = true
    }
  }, [open, payload])

  if (!open) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/40" role="dialog" aria-label={`Share ${label}`}>
      <div className="w-full max-w-md rounded-t-2xl bg-[var(--navi-card)] p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--navi-text)]">
            <Share2 className="h-4 w-4 text-[var(--navi-primary)]" />
            Share location
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--navi-text-secondary)] hover:bg-[var(--navi-border)]/50"
            aria-label="Close share dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-center">
          <div className="text-sm font-medium text-[var(--navi-text)]">{label}</div>
          {sublabel && <div className="text-xs text-[var(--navi-text-secondary)]">{sublabel}</div>}
        </div>

        <div className="my-4 flex justify-center">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt={`NAVI code for ${label}`}
              width={240}
              height={240}
              className="rounded-xl border border-[var(--navi-border)]"
            />
          ) : (
            <div className="flex h-60 w-60 items-center justify-center rounded-xl border border-[var(--navi-border)] text-xs text-[var(--navi-text-secondary)]">
              Generating code…
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-[var(--navi-content)] px-3 py-2">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--navi-text-secondary)]" />
          <code className="min-w-0 flex-1 truncate text-xs text-[var(--navi-text)]">{payload}</code>
          <button
            onClick={copy}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--navi-primary)] px-3 py-1.5 text-xs font-semibold text-white"
            aria-label="Copy NAVI code"
          >
            <Copy className="h-3 w-3" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-[var(--navi-text-secondary)]">
          Scan this code in NAVI to set your current location, or share it with a visitor heading here.
        </p>
      </div>
    </div>
  )
}
