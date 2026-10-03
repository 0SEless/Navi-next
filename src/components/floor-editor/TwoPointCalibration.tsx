'use client'

import { useState, useCallback } from 'react'
import type { PlanAlignment } from '@navi/core'
import type { Point2D, CalibrationError, CalibrationFrame, CalibrationImageSize } from '@/lib/two-point-calibration'
import { validatePlanPoints, validateMapPoints, computeTwoPointAlignment } from '@/lib/two-point-calibration'

interface TwoPointCalibrationProps {
  imageWidth: number
  imageHeight: number
  buildingFootprint: Point2D[]
  footprintFrame: CalibrationFrame
  onApply: (alignment: PlanAlignment) => void
  onClose: () => void
  planA: Point2D | null
  planB: Point2D | null
  mapA: Point2D | null
  mapB: Point2D | null
  error: CalibrationError | null
}

export type CalibrationStep = 'plan-a' | 'plan-b' | 'map-a' | 'map-b' | 'preview'

export function validateCalibrationPoints(
  step: CalibrationStep,
  newPoint: Point2D,
  planA: Point2D | null,
  planB: Point2D | null,
  mapA: Point2D | null,
  imageWidth: number,
  imageHeight: number,
  buildingFootprint: Point2D[],
): CalibrationError | null {
  if (step === 'plan-b' && planA) {
    return validatePlanPoints(planA, newPoint, imageWidth, imageHeight)
  }
  if (step === 'map-b' && mapA) {
    return validateMapPoints(mapA, newPoint, buildingFootprint)
  }
  return null
}

export function computeCalibration(
  planA: Point2D,
  planB: Point2D,
  mapA: Point2D,
  mapB: Point2D,
  imageSize: CalibrationImageSize,
  footprintFrame: CalibrationFrame,
): { alignment: PlanAlignment } | { error: CalibrationError } {
  try {
    const alignment = computeTwoPointAlignment([planA, planB], [mapA, mapB], imageSize, footprintFrame)
    return { alignment }
  } catch (e) {
    return { error: { code: 'COMPUTATION_FAILED', message: String(e) } }
  }
}

export function TwoPointCalibration({
  imageWidth,
  imageHeight,
  buildingFootprint,
  footprintFrame,
  onApply,
  onClose,
  planA,
  planB,
  mapA,
  mapB,
  error,
}: TwoPointCalibrationProps) {
  const planPoints: [Point2D, Point2D] | null = planA && planB ? [planA, planB] : null
  const mapPts: [Point2D, Point2D] | null = mapA && mapB ? [mapA, mapB] : null
  const computed = planPoints && mapPts && imageWidth > 0 && imageHeight > 0 && footprintFrame.width > 0 && footprintFrame.height > 0
    ? computeTwoPointAlignment(planPoints, mapPts, { width: imageWidth, height: imageHeight }, footprintFrame)
    : null

  const handleConfirm = useCallback(() => {
    if (computed) onApply(computed)
  }, [computed, onApply])

  const planDist = planA && planB ? Math.hypot(planB[0] - planA[0], planB[1] - planA[1]).toFixed(0) : null
  const mapDist = mapA && mapB ? Math.hypot(mapB[0] - mapA[0], mapB[1] - mapA[1]).toFixed(1) : null

  const step: CalibrationStep = !planA ? 'plan-a' : !planB ? 'plan-b' : !mapA ? 'map-a' : !mapB ? 'map-b' : 'preview'

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
        minWidth: 380,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9', marginBottom: 10 }}>
        Two-Point Calibration
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, padding: '6px 10px', marginBottom: 8, fontSize: 11, color: '#FCA5A5' }}>
          {error.message}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: '#94A3B8' }}>
        {step === 'plan-a' && (
          <>
            <div style={{ color: '#E2E8F0' }}>Step 1: Click point A on the floor plan</div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Choose a well-separated reference point (corner, door, etc.)</div>
          </>
        )}
        {step === 'plan-b' && (
          <>
            <div style={{ color: '#E2E8F0' }}>Step 2: Click point B on the floor plan</div>
            {planA && <div style={{ fontSize: 10, color: '#38BDF8' }}>Point A: ({planA[0].toFixed(0)}, {planA[1].toFixed(0)}) px</div>}
          </>
        )}
        {step === 'map-a' && (
          <>
            <div style={{ color: '#E2E8F0' }}>Step 3: Click point A on the map</div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Click the same reference point on the building footprint</div>
            {planA && <div style={{ fontSize: 10, color: '#38BDF8' }}>Plan A: ({planA[0].toFixed(0)}, {planA[1].toFixed(0)}) px</div>}
            {planB && <div style={{ fontSize: 10, color: '#38BDF8' }}>Plan B: ({planB[0].toFixed(0)}, {planB[1].toFixed(0)}) px</div>}
          </>
        )}
        {step === 'map-b' && (
          <>
            <div style={{ color: '#E2E8F0' }}>Step 4: Click point B on the map</div>
            {planA && <div style={{ fontSize: 10, color: '#38BDF8' }}>Plan A: ({planA[0].toFixed(0)}, {planA[1].toFixed(0)}) px</div>}
            {planB && <div style={{ fontSize: 10, color: '#38BDF8' }}>Plan B: ({planB[0].toFixed(0)}, {planB[1].toFixed(0)}) px</div>}
            {mapA && <div style={{ fontSize: 10, color: '#10B981' }}>Map A: ({mapA[0].toFixed(1)}, {mapA[1].toFixed(1)}) m</div>}
          </>
        )}
        {step === 'preview' && computed && (
          <>
            <div style={{ color: '#E2E8F0' }}>Preview — Computed Alignment</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', marginTop: 4 }}>
              <div style={{ fontSize: 10, color: '#64748B' }}>Scale:</div>
              <div style={{ fontSize: 10, color: '#10B981', fontWeight: 600 }}>{computed.scaleX ?? computed.scale ?? 1}x</div>
              <div style={{ fontSize: 10, color: '#64748B' }}>Rotation:</div>
              <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600 }}>{computed.rotation}°</div>
              <div style={{ fontSize: 10, color: '#64748B' }}>Offset X:</div>
              <div style={{ fontSize: 10, color: '#38BDF8', fontWeight: 600 }}>{computed.offset?.x} m</div>
              <div style={{ fontSize: 10, color: '#64748B' }}>Offset Y:</div>
              <div style={{ fontSize: 10, color: '#38BDF8', fontWeight: 600 }}>{computed.offset?.y} m</div>
            </div>
            {planDist && mapDist && (
              <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
                Physical scale: {mapDist}m / {planDist}px
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        {step === 'preview' && (
          <button
            onClick={handleConfirm}
            style={{
              padding: '5px 14px', borderRadius: 4, background: '#10B981',
              border: 'none', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Apply Calibration
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            padding: '5px 12px', borderRadius: 4, background: 'transparent',
            border: '1px solid #475569', color: '#94A3B8', fontSize: 11, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
