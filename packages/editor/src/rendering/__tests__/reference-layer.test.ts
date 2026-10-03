import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  renderReferenceImage,
  clearReferenceArea,
  computeImageCorners,
  DEFAULT_REFERENCE_IMAGE_STYLE,
} from '../reference-layer'
import type { PlanAlignment } from '../reference-layer'

function createMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    rect: vi.fn(),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D
}

function createMockImage(w = 100, h = 80): HTMLImageElement {
  return { width: w, height: h } as unknown as HTMLImageElement
}

function defaultAlignment(): PlanAlignment {
  return { offset: { x: 0, y: 0 }, scale: 1, rotation: 0, opacity: 0.7 }
}

describe('computeImageCorners', () => {
  const bbox = { x: 0, y: 0, width: 200, height: 100 }

  it('returns bbox corners when no alignment transform is applied', () => {
    const corners = computeImageCorners(bbox, defaultAlignment())
    expect(corners[0]).toEqual([0, 0])
    expect(corners[1]).toEqual([200, 0])
    expect(corners[2]).toEqual([200, 100])
    expect(corners[3]).toEqual([0, 100])
  })

  it('applies scale factor', () => {
    const alignment = { ...defaultAlignment(), scale: 2 }
    const corners = computeImageCorners(bbox, alignment)
    expect(corners[0]).toEqual([-100, -50])
    expect(corners[1]).toEqual([300, -50])
    expect(corners[2]).toEqual([300, 150])
    expect(corners[3]).toEqual([-100, 150])
  })

  it('applies offset', () => {
    const alignment = { ...defaultAlignment(), offset: { x: 10, y: 20 } }
    const corners = computeImageCorners(bbox, alignment)
    expect(corners[0]).toEqual([10, 20])
    expect(corners[1]).toEqual([210, 20])
    expect(corners[2]).toEqual([210, 120])
    expect(corners[3]).toEqual([10, 120])
  })

  it('applies 90 degree rotation', () => {
    const alignment = { ...defaultAlignment(), rotation: 90 }
    const corners = computeImageCorners(bbox, alignment)
    const cx = 100, cy = 50
    const hw = 100, hh = 50
    const rad = (90 * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const dx = -hw, dy = -hh
    const rx = cx + dx * cos - dy * sin
    const ry = cy + dx * sin + dy * cos
    expect(corners[0][0]).toBeCloseTo(rx, 10)
    expect(corners[0][1]).toBeCloseTo(ry, 10)
  })

  it('returns four corners', () => {
    const corners = computeImageCorners(bbox, defaultAlignment())
    expect(corners).toHaveLength(4)
    for (const corner of corners) {
      expect(corner).toHaveLength(2)
      expect(typeof corner[0]).toBe('number')
    }
  })
})

describe('renderReferenceImage', () => {
  let ctx: CanvasRenderingContext2D
  let image: HTMLImageElement

  beforeEach(() => {
    ctx = createMockCtx()
    image = createMockImage(100, 80)
  })

  it('saves and restores canvas state', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    renderReferenceImage(ctx, image, defaultAlignment(), bbox)
    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
  })

  it('sets globalAlpha based on alignment opacity', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    const alignment = { ...defaultAlignment(), opacity: 0.5 }
    renderReferenceImage(ctx, image, alignment, bbox)
    expect(ctx.globalAlpha).toBe(0.5 * DEFAULT_REFERENCE_IMAGE_STYLE.opacity)
  })

  it('calls drawImage with computed transform', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    renderReferenceImage(ctx, image, defaultAlignment(), bbox)
    expect(ctx.setTransform).toHaveBeenCalled()
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 100, 80)
  })

  it('draws border when borderWidth > 0', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    renderReferenceImage(ctx, image, defaultAlignment(), bbox, { borderWidth: 2 })
    expect(ctx.stroke).toHaveBeenCalled()
  })

  it('skips border when borderWidth is 0', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    renderReferenceImage(ctx, image, defaultAlignment(), bbox, { borderWidth: 0 })
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('applies custom style overrides', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    renderReferenceImage(ctx, image, defaultAlignment(), bbox, { opacity: 0.3 })
    expect(ctx.globalAlpha).toBeCloseTo(0.21, 10)
  })
})

describe('clearReferenceArea', () => {
  let ctx: CanvasRenderingContext2D

  beforeEach(() => {
    ctx = createMockCtx()
  })

  it('fills the reference quad with the given color', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    clearReferenceArea(ctx, defaultAlignment(), bbox, '#FF0000')
    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.moveTo).toHaveBeenCalled()
    expect(ctx.lineTo).toHaveBeenCalledTimes(3)
    expect(ctx.closePath).toHaveBeenCalled()
    expect(ctx.fillStyle).toBe('#FF0000')
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
  })

  it('defaults to white fill color', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    clearReferenceArea(ctx, defaultAlignment(), bbox)
    expect(ctx.fillStyle).toBe('#FFFFFF')
  })

  it('handles scaled alignment', () => {
    const bbox = { x: 0, y: 0, width: 200, height: 100 }
    const alignment = { ...defaultAlignment(), scale: 1.5 }
    clearReferenceArea(ctx, alignment, bbox)
    expect(ctx.fill).toHaveBeenCalled()
  })
})
