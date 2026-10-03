'use client'

import { Compass } from 'lucide-react'
import type { CaptureOrientationMode } from '../camera'

export interface CaptureOrientationControlProps {
  orientationMode: CaptureOrientationMode
  headingAvailable: boolean
  onChange: (mode: CaptureOrientationMode) => void
}

export function CaptureOrientationControl({ orientationMode, headingAvailable, onChange }: CaptureOrientationControlProps) {
  const headingUp = orientationMode === 'heading-up'
  const nextMode: CaptureOrientationMode = headingUp ? 'north-up' : 'heading-up'
  const label = headingUp ? 'Use North-Up' : 'Use Heading-Up'
  const title = headingUp && !headingAvailable
    ? 'Heading-Up selected; waiting for a reliable heading'
    : label

  return (
    <button
      type="button"
      data-testid="capture-orientation"
      aria-label={label}
      aria-pressed={headingUp}
      title={title}
      onClick={() => onChange(nextMode)}
      style={{
        width: 44,
        height: 44,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--navi-border)',
        borderRadius: 999,
        color: headingUp && headingAvailable ? 'var(--navi-primary)' : 'var(--navi-text)',
        background: 'var(--navi-card)',
        boxShadow: 'var(--navi-shadow-sm)',
        cursor: 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <Compass size={19} aria-hidden="true" />
    </button>
  )
}
