'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Compass, Eye, LocateFixed, Navigation } from 'lucide-react'
import type {
  NavigationCameraMode,
  NavigationCameraSurface,
} from '@/lib/navigation-camera-policy'

export type NavigationHeadingStatus =
  | 'device'
  | 'gps'
  | 'none'
  | 'stale'
  | 'permission-required'
  | 'denied'
  | 'unsupported'

export interface NavigationCameraControlsProps {
  surface: NavigationCameraSurface
  mode: NavigationCameraMode
  className?: string
  hasLocation: boolean
  compassVisible: boolean
  suspended?: boolean
  headingStatus?: NavigationHeadingStatus
  canRequestHeadingPermission?: boolean
  reducedMotion?: boolean
  headingFollowEnabled?: boolean
  onModeChange: (mode: NavigationCameraMode) => void
  onRecenter: () => void
  onResetCompass: () => void
  onToggleHeadingFollow?: (enabled: boolean) => void
  onRequestHeadingPermission?: () => void
}

const MODE_OPTIONS: Array<{
  mode: NavigationCameraMode
  label: string
  description: string
}> = [
  { mode: 'TOP', label: 'Top', description: 'Flat campus overview' },
  { mode: 'FOLLOW', label: 'Follow', description: 'Heading-up with forward view' },
  { mode: 'POV', label: 'POV', description: 'Steeper forward perspective' },
]

function modeLabel(mode: NavigationCameraMode): string {
  return MODE_OPTIONS.find(option => option.mode === mode)?.label ?? 'Top'
}

/** Accessible camera controls shared by Explore and active navigation. */
export default function NavigationCameraControls({
  surface,
  mode,
  className,
  hasLocation,
  compassVisible,
  suspended = false,
  headingStatus = 'none',
  canRequestHeadingPermission = false,
  reducedMotion = false,
  headingFollowEnabled = false,
  onModeChange,
  onRecenter,
  onResetCompass,
  onToggleHeadingFollow,
  onRequestHeadingPermission,
}: NavigationCameraControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const overviewOnly = surface !== 'active'
  const currentMode = overviewOnly ? 'TOP' : mode
  const selectedLabel = modeLabel(currentMode)
  const latestModeRef = useRef(currentMode)

  useEffect(() => {
    latestModeRef.current = currentMode
  }, [currentMode])

  const cycleMode = () => {
    if (overviewOnly) return
    const order: NavigationCameraMode[] = ['TOP', 'FOLLOW', 'POV']
    const idx = order.indexOf(latestModeRef.current)
    const next = order[(idx + 1) % order.length]
    latestModeRef.current = next
    onModeChange(next)
  }

  return (
    <div
      className={`pointer-events-auto absolute right-3 top-[58%] z-30 flex -translate-y-1/2 flex-col items-end gap-2 sm:right-4 ${className ?? ''}`}
      style={{ right: 'max(0.75rem, env(safe-area-inset-right, 0px))' }}
      data-testid="navigation-camera-controls"
      data-reduced-motion={String(reducedMotion)}
      data-compass-visible={String(compassVisible)}
      data-heading-status={headingStatus}
    >
      <div className="relative">
        <button
          type="button"
          className="flex h-11 w-11 min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl border border-[var(--navi-border)] bg-[var(--navi-card)] text-[var(--navi-text)] shadow-lg"
          aria-label={`Camera view: ${selectedLabel}. Tap to cycle, long press for options.`}
          title={selectedLabel}
          onClick={cycleMode}
          onContextMenu={(e) => {
            e.preventDefault()
            if (!overviewOnly) setMenuOpen(open => !open)
          }}
        >
          {currentMode === 'FOLLOW' && <Navigation className="h-4 w-4" aria-hidden="true" />}
          {currentMode === 'POV' && <Eye className="h-4 w-4" aria-hidden="true" />}
          {currentMode === 'TOP' && <span className="text-[10px] font-bold leading-none">TOP</span>}
        </button>

        {menuOpen && (
          <div
            id={menuId}
            role="menu"
            className="absolute right-0 mt-1.5 w-44 rounded-xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-1 shadow-xl"
          >
            {MODE_OPTIONS.map(option => {
              const disabled = overviewOnly && option.mode !== 'TOP'
              return (
                <button
                  key={option.mode}
                  type="button"
                  aria-label={`${option.label} view`}
                  className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--navi-text)] enabled:hover:bg-[var(--navi-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                  aria-pressed={option.mode === currentMode}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return
                    setMenuOpen(false)
                    latestModeRef.current = option.mode
                    onModeChange(option.mode)
                  }}
                >
                  <span className="w-4 shrink-0 text-center">
                    {option.mode === 'TOP' && 'T'}
                    {option.mode === 'FOLLOW' && <Navigation className="h-3.5 w-3.5" />}
                    {option.mode === 'POV' && <Eye className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate">{option.description}</span>
                  {option.mode === currentMode && (
                    <span className="ml-auto shrink-0 text-[10px] font-semibold text-[var(--navi-accent)]">&#10003;</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        className="flex h-11 w-11 min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl border border-[var(--navi-border)] bg-[var(--navi-card)] text-[var(--navi-text)] shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Recenter"
        title="Recenter"
        disabled={!hasLocation}
        onClick={onRecenter}
      >
        <LocateFixed className="h-4 w-4" aria-hidden="true" />
      </button>

      {surface === 'active' && (
        <button
          type="button"
          className={`flex h-11 w-11 min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl border bg-[var(--navi-card)] text-[var(--navi-text)] shadow-lg ${headingFollowEnabled ? 'border-emerald-500/60' : 'border-[var(--navi-border)]'}`}
          aria-label={headingFollowEnabled ? 'Turn heading follow off' : 'Turn heading follow on'}
          aria-pressed={headingFollowEnabled}
          title={`Heading follow ${headingFollowEnabled ? 'ON' : 'OFF'}`}
          onClick={() => {
            const nextEnabled = !headingFollowEnabled
            if (onToggleHeadingFollow) onToggleHeadingFollow(nextEnabled)
            else onResetCompass()
          }}
        >
          <Compass className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {suspended && (
        <div className="pointer-events-none max-w-32 text-right text-xs text-[var(--navi-muted)]" aria-live="polite">
          Following paused
        </div>
      )}
      {headingStatus === 'permission-required' && canRequestHeadingPermission && onRequestHeadingPermission && (
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--navi-primary)]/30 bg-[var(--navi-primary)]/10 px-2.5 text-[11px] font-medium text-[var(--navi-primary)] shadow-sm"
          onClick={onRequestHeadingPermission}
        >
          <Compass className="h-3.5 w-3.5" aria-hidden="true" />
          Enable compass
        </button>
      )}
    </div>
  )
}
