'use client'

import { useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

interface QRScannerProps {
  onScan?: (nodeId: string) => void
  /** Forward the decoded text to the caller's shared resolver. */
  onPayload?: (payload: string) => void
  onError?: (error: string) => void
}

/**
 * Camera-based QR scanner. Never throws: start()/stop() failures (no
 * camera, headless browsers, missing element) are swallowed and routed
 * to onError. Cleanup guards against html5-qrcode's synchronous
 * "Cannot stop, scanner is not running" throw — an unhandled version
 * would propagate through the effect cleanup and crash the page.
 */
export function QRScanner({ onScan, onPayload, onError }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const runningRef = useRef(false)

  useEffect(() => {
    let scanner: Html5Qrcode | null = null
    try {
      scanner = new Html5Qrcode('qr-reader')
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Camera element unavailable')
      return
    }
    scannerRef.current = scanner
    runningRef.current = false

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (onPayload) {
            onPayload(decodedText)
          } else {
            let nodeId = decodedText
            const match = decodedText.match(/[?&]node=([^&]+)/)
            if (match) {
              nodeId = decodeURIComponent(match[1])
            }
            onScan?.(nodeId)
          }
          runningRef.current = false
          try {
            void scanner?.stop()
          } catch {
            /* ignore */
          }
        },
        () => {
          /* ignore non-decode frames */
        },
      )
      .then(() => {
        runningRef.current = true
      })
      .catch((err) => {
        onError?.(err?.toString?.() ?? 'Camera error')
      })

    return () => {
      if (scannerRef.current) {
        try {
          if (runningRef.current) void scannerRef.current.stop()
        } catch {
          /* ignore synchronous stop() throws */
        }
        scannerRef.current = null
        runningRef.current = false
      }
    }
  }, [onScan, onPayload, onError])

  return <div id="qr-reader" />
}
