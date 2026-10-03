'use client'

import { useState, useCallback } from 'react'

interface ScaleCalibrationProps {
  currentScale: number
  onApplyScale: (newScale: number) => void
  onClose: () => void
}

export function ScaleCalibration({ currentScale, onApplyScale, onClose }: ScaleCalibrationProps) {
  const [knownDistance, setKnownDistance] = useState('10')
  const [measuredPixels, setMeasuredPixels] = useState('100')

  const handleApply = useCallback(() => {
    const dist = parseFloat(knownDistance)
    const px = parseFloat(measuredPixels)
    if (!isNaN(dist) && dist > 0 && !isNaN(px) && px > 0) {
      // W12B: calibratedScale = knownDistance / measuredPixelDistance * currentScale
      // If the user measures 100px on the plan and says that segment = 10m,
      // the new scale adjusts so 100px maps to 10m in building-local space.
      const calibratedScale = Math.round((dist / px * currentScale) * 100) / 100
      onApplyScale(Math.max(0.1, Math.min(20, calibratedScale)))
      onClose()
    }
  }, [knownDistance, measuredPixels, currentScale, onApplyScale, onClose])

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        background: '#1E293B',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: '14px 20px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 12, color: '#F1F5F9', fontWeight: 500 }}>
        Measure (px):
      </div>
      <input
        type="number"
        min="1"
        step="10"
        value={measuredPixels}
        onChange={(e) => setMeasuredPixels(e.target.value)}
        style={{
          width: 60,
          background: '#0F172A',
          border: '1px solid #334155',
          borderRadius: 4,
          padding: '4px 8px',
          color: '#FFFFFF',
          fontSize: 12,
        }}
      />
      <div style={{ fontSize: 12, color: '#F1F5F9', fontWeight: 500 }}>
        = Real (m):
      </div>
      <input
        type="number"
        min="0.1"
        step="0.5"
        value={knownDistance}
        onChange={(e) => setKnownDistance(e.target.value)}
        style={{
          width: 60,
          background: '#0F172A',
          border: '1px solid #334155',
          borderRadius: 4,
          padding: '4px 8px',
          color: '#FFFFFF',
          fontSize: 12,
        }}
      />
      <button
        onClick={handleApply}
        style={{
          padding: '5px 12px',
          borderRadius: 4,
          background: '#3B82F6',
          border: 'none',
          color: '#FFFFFF',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Apply
      </button>
      <button
        onClick={onClose}
        style={{
          padding: '5px 10px',
          borderRadius: 4,
          background: 'transparent',
          border: '1px solid #475569',
          color: '#94A3B8',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  )
}
