'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Activity, CirclePause, CirclePlay, Clock3, MapPin, MapPinned, Ruler, Square } from 'lucide-react'
import { calculateCaptureDistanceMeters, classifyCaptureAccuracy, formatCaptureDistance, formatCaptureDuration, getActiveCaptureDurationMs, getCaptureGpsReadiness } from '../metrics'
import type { CaptureDirectionResolution } from '../direction'
import type { CaptureSession } from '../types'
import { CaptureDirectionStatus } from './CaptureDirectionStatus'

export interface CaptureLiveHudProps {
  session: CaptureSession
  nowMs?: number
  direction?: CaptureDirectionResolution
  canRequestDirection?: boolean
  onEnableDirection?: () => void | Promise<void>
  onMarker?: () => void | Promise<void>
  onStart?: () => void | Promise<void>
  onPause?: () => void | Promise<void>
  onResume?: () => void | Promise<void>
  onFinish?: () => void | Promise<void>
}

function formatAccuracy(accuracy: number | null | undefined): string {
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) return 'Accuracy unavailable'
  const value = Number.isInteger(accuracy) ? String(accuracy) : accuracy.toFixed(1).replace(/\.0$/, '')
  return `±${value} m`
}

function qualityLabel(quality: ReturnType<typeof classifyCaptureAccuracy>): string {
  return quality === 'unknown' ? 'Unknown' : quality.charAt(0).toUpperCase() + quality.slice(1)
}

function statusLabel(status: CaptureSession['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function statusColor(status: CaptureSession['status']): string {
  if (status === 'recording') return 'var(--navi-success)'
  if (status === 'preparing' || status === 'paused') return 'var(--navi-primary)'
  return 'var(--navi-text-secondary)'
}

function gpsState(session: CaptureSession): string {
  if (session.lastError) return 'GPS unavailable'
  const position = session.lastPosition ?? session.rawSamples.at(-1) ?? null
  switch (getCaptureGpsReadiness(position)) {
    case 'ready':
      return 'GPS ready'
    case 'poor':
      return 'Poor accuracy'
    case 'unknown':
      return 'GPS quality unknown'
    case 'acquiring':
    default:
      return 'Waiting for GPS'
  }
}

function gpsColor(session: CaptureSession): string {
  if (session.lastError) return 'var(--navi-error)'
  const position = session.lastPosition ?? session.rawSamples.at(-1) ?? null
  switch (getCaptureGpsReadiness(position)) {
    case 'ready':
      return 'var(--navi-success)'
    case 'poor':
      return 'var(--navi-warning)'
    default:
      return 'var(--navi-text-secondary)'
  }
}

function actionButtonStyle(kind: 'marker' | 'primary' | 'pause' | 'finish'): React.CSSProperties {
  const palette = {
    marker: { border: '1px solid var(--navi-border)', color: 'var(--navi-primary)', background: 'var(--navi-card)' },
    primary: { border: 0, color: '#fff', background: 'var(--navi-primary)' },
    pause: { border: '1px solid var(--navi-primary)', color: 'var(--navi-primary-dark)', background: 'var(--navi-primary-light)' },
    finish: { border: 0, color: '#fff', background: 'var(--navi-success)' },
  }[kind]

  return {
    ...palette,
    minWidth: 0,
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '0 10px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    touchAction: 'manipulation',
  }
}

export function CaptureLiveHud({ session, nowMs, direction, canRequestDirection = false, onEnableDirection, onMarker, onStart, onPause, onResume, onFinish }: CaptureLiveHudProps) {
  const [clockNow, setClockNow] = useState(() => nowMs ?? Date.now())

  useEffect(() => {
    if (nowMs !== undefined || session.status === 'finished') {
      setClockNow(nowMs ?? Date.now())
      return undefined
    }

    const updateClock = () => setClockNow(Date.now())
    updateClock()
    const intervalId = window.setInterval(updateClock, 1_000)
    return () => window.clearInterval(intervalId)
  }, [nowMs, session.status])

  const lastPosition = session.lastPosition ?? session.rawSamples.at(-1) ?? null
  const quality = classifyCaptureAccuracy(lastPosition?.accuracy)
  const distance = calculateCaptureDistanceMeters(session.rawSamples)
  const duration = getActiveCaptureDurationMs(session, nowMs ?? clockNow)
  const isPreparing = session.status === 'preparing'
  const showMetrics = session.status === 'recording' || session.status === 'paused'
  const showActions = Boolean(onMarker || onStart || onPause || onResume || onFinish)
  const showFinish = !isPreparing && Boolean(onFinish)

  return (
    <aside
      data-testid="capture-bottom-hud"
      data-layout="merged-bottom"
      role="region"
      aria-label="Live Capture HUD"
      style={{
        flexShrink: 0,
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: '8px 12px calc(8px + env(safe-area-inset-bottom))',
        borderTop: '1px solid var(--navi-border)',
        background: 'var(--navi-card)',
        color: 'var(--navi-text)',
        boxShadow: '0 -4px 14px rgba(15, 23, 42, 0.08)',
        overflowX: 'hidden',
      }}
    >
      {session.lastError && <p role="alert" style={{ margin: '0 0 7px', color: 'var(--navi-error)', fontSize: 12 }}>{session.lastError}</p>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 13, fontWeight: 750 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, flex: '0 0 auto', borderRadius: '50%', background: statusColor(session.status) }} />
          <Activity size={15} aria-hidden="true" />
          <span>{statusLabel(session.status)}</span>
        </div>
        <span data-testid="capture-hud-gps" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: gpsColor(session), fontSize: 12, fontWeight: 650 }}>
          <span>{gpsState(session)}</span> · <span>{formatAccuracy(lastPosition?.accuracy)}</span> · <span>{qualityLabel(quality)}</span>
        </span>
      </div>
      {isPreparing && direction && onEnableDirection && (
        <div style={{ marginTop: 6, minWidth: 0 }}>
          <CaptureDirectionStatus direction={direction} canRequestPermission={canRequestDirection} onEnable={onEnableDirection} />
        </div>
      )}
      {showMetrics && (
        <dl data-testid="capture-hud-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, minWidth: 0, margin: '7px 0 0' }}>
          <HudMetric metric="active-time" icon={<Clock3 size={13} aria-hidden="true" />} label="Active time" value={formatCaptureDuration(duration)} />
          <HudMetric metric="distance" icon={<Ruler size={13} aria-hidden="true" />} label="Distance" value={formatCaptureDistance(distance)} />
          <HudMetric metric="samples" icon={<MapPinned size={13} aria-hidden="true" />} label="Samples" value={`${session.rawSamples.length} samples`} compact />
        </dl>
      )}
      {showActions && (
        <div
          data-testid="capture-hud-actions"
          style={{
            display: 'grid',
            gridTemplateColumns: isPreparing ? 'minmax(96px, .8fr) minmax(0, 1.6fr)' : 'minmax(92px, .9fr) minmax(0, 1.2fr) minmax(0, 1fr)',
            gap: 8,
            minWidth: 0,
            marginTop: 8,
          }}
        >
          {onMarker && session.status !== 'finished' && (
            <button type="button" aria-label="Add marker" disabled={!lastPosition} onClick={() => { void onMarker() }} style={{ ...actionButtonStyle('marker'), cursor: lastPosition ? 'pointer' : 'not-allowed', opacity: lastPosition ? 1 : 0.55 }}>
              <MapPin size={17} aria-hidden="true" />Marker
            </button>
          )}
          {isPreparing && onStart && (
            <button type="button" aria-label="Start recording" onClick={() => { void onStart() }} style={actionButtonStyle('primary')}>
              <CirclePlay size={18} aria-hidden="true" />Start
            </button>
          )}
          {session.status === 'recording' && onPause && (
            <button type="button" aria-label="Pause recording" onClick={() => { void onPause() }} style={actionButtonStyle('pause')}>
              <CirclePause size={18} aria-hidden="true" />Pause
            </button>
          )}
          {session.status === 'paused' && onResume && (
            <button type="button" aria-label="Resume recording" onClick={() => { void onResume() }} style={actionButtonStyle('primary')}>
              <CirclePlay size={18} aria-hidden="true" />Resume
            </button>
          )}
          {showFinish && (
            <button type="button" aria-label="Finish capture" onClick={() => { void onFinish?.() }} style={actionButtonStyle('finish')}>
              <Square size={15} aria-hidden="true" />Finish
            </button>
          )}
        </div>
      )}
    </aside>
  )
}

function HudMetric({ metric, icon, label, value, compact = false }: { metric: string; icon?: ReactNode; label: string; value: string; compact?: boolean }) {
  return (
    <div data-testid={`capture-hud-metric-${metric}`} style={{ minWidth: 0, padding: compact ? '5px 6px' : '6px 7px', border: '1px solid var(--navi-border)', borderRadius: 8, background: 'var(--navi-content)' }}>
      <dt style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, color: 'var(--navi-text-secondary)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{icon}{label}</dt>
      <dd style={{ margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: compact ? 11 : 13, fontWeight: 750 }}>{value}</dd>
    </div>
  )
}
