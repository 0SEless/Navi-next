import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_PLAN_ACCEPT,
  isSupportedPlanFile,
  needsRasterization,
  capRenderScale,
  PLAN_RASTER_MAX_DIMENSION_PX,
} from '../plan-upload'

// P1-T14 (R4.3): PDF floor-plan upload contract — PDFs accepted and
// rasterized (reference layer), rasters pass through unchanged, no second
// coordinate transform (D5).

describe('P1-T14: plan upload accept-list (R4.3)', () => {
  it('the accept list includes PDF plus the existing raster formats', () => {
    expect(SUPPORTED_PLAN_ACCEPT).toContain('application/pdf')
    expect(SUPPORTED_PLAN_ACCEPT).toContain('.pdf')
    expect(SUPPORTED_PLAN_ACCEPT).toContain('image/png')
    expect(SUPPORTED_PLAN_ACCEPT).toContain('image/jpeg')
    expect(SUPPORTED_PLAN_ACCEPT).toContain('image/webp')
  })

  it('accepts PDF and raster files (by name and mime)', () => {
    expect(isSupportedPlanFile({ name: 'plan.pdf' })).toBe(true)
    expect(isSupportedPlanFile({ name: 'PLAN.PDF' })).toBe(true)
    expect(isSupportedPlanFile({ name: 'plan.png' })).toBe(true)
    expect(isSupportedPlanFile({ name: 'plan.jpg' })).toBe(true)
    expect(isSupportedPlanFile({ name: 'plan.jpeg' })).toBe(true)
    expect(isSupportedPlanFile({ name: 'plan.webp' })).toBe(true)
    expect(isSupportedPlanFile({ name: 'noext', type: 'application/pdf' })).toBe(true)
    expect(isSupportedPlanFile({ name: 'plan.png', type: 'image/png' })).toBe(true)
  })

  it('rejects unsupported file types (non-PDF/non-raster)', () => {
    expect(isSupportedPlanFile({ name: 'plan.txt' })).toBe(false)
    expect(isSupportedPlanFile({ name: 'plan.exe' })).toBe(false)
    expect(isSupportedPlanFile({ name: 'plan.doc', type: 'application/msword' })).toBe(false)
  })

  it('only PDFs require rasterization — rasters pass through unchanged (D5)', () => {
    expect(needsRasterization({ name: 'plan.pdf' })).toBe(true)
    expect(needsRasterization({ name: 'plan.PDF' })).toBe(true)
    expect(needsRasterization({ name: 'plan', type: 'application/pdf' })).toBe(true)
    expect(needsRasterization({ name: 'plan.png' })).toBe(false)
    expect(needsRasterization({ name: 'plan.jpg' })).toBe(false)
    expect(needsRasterization({ name: 'plan.webp' })).toBe(false)
  })
})

describe('P1-T14: PDF rasterization sizing (resolution cap)', () => {
  it('caps the largest dimension at the configured max, preserving aspect', () => {
    // A4 portrait (595 x 842 pt) at the 2000px cap → scale 1 (already small)
    const small = capRenderScale(595, 842)
    expect(small.scale).toBe(1)
    expect(small.width).toBe(595)
    expect(small.height).toBe(842)

    // Large page (4000 x 3000) → capped to 2000 x 1500
    const capped = capRenderScale(4000, 3000)
    expect(capped.scale).toBeCloseTo(0.5, 9)
    expect(capped.width).toBe(2000)
    expect(capped.height).toBe(1500)
    expect(Math.max(capped.width, capped.height)).toBeLessThanOrEqual(PLAN_RASTER_MAX_DIMENSION_PX)
  })

  it('always yields at least 1x1 integer pixels', () => {
    const tiny = capRenderScale(1, 1)
    expect(tiny.width).toBe(1)
    expect(tiny.height).toBe(1)
    const zero = capRenderScale(0, 0)
    expect(zero.width).toBeGreaterThanOrEqual(1)
    expect(zero.height).toBeGreaterThanOrEqual(1)
  })
})