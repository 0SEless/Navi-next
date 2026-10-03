// ── Reference Image Alignment Types ──
// W12B: PlanAlignment is canonical in @navi/core.
// Re-exported here for backward compatibility within the editor package.
import type { PlanAlignment } from '@navi/core'
export type { PlanAlignment }

export interface ReferenceImageStyle {
  opacity: number
  borderColor: string
  borderWidth: number
}

// ── Default styles ──

export const DEFAULT_REFERENCE_IMAGE_STYLE: ReferenceImageStyle = {
  opacity: 1.0,
  borderColor: 'rgba(59, 130, 246, 0.3)',
  borderWidth: 1,
}

// ── Transform helpers ──

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Compute the four corner positions for a reference image given alignment
 * parameters and a bounding box in canvas space.
 *
 * Transform order: translate to center → rotate → scale → translate by offset.
 *
 * @param bbox - Bounding box { x, y, width, height } in canvas units
 * @param alignment - The plan alignment (offset, scale, rotation, opacity)
 * @returns Four corner points [topLeft, topRight, bottomRight, bottomLeft] as [x, y] pairs
 */
export function computeImageCorners(
  bbox: { x: number; y: number; width: number; height: number },
  alignment: PlanAlignment,
): [[number, number], [number, number], [number, number], [number, number]] {
  const cx = bbox.x + bbox.width / 2
  const cy = bbox.y + bbox.height / 2
  const hw = (bbox.width * alignment.scale) / 2
  const hh = (bbox.height * alignment.scale) / 2
  const rad = degToRad(alignment.rotation)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // Corners relative to center (before rotation)
  const corners: [number, number][] = [
    [-hw, -hh], // top-left
    [hw, -hh],  // top-right
    [hw, hh],   // bottom-right
    [-hw, hh],  // bottom-left
  ]

  // Rotate and translate
  return corners.map(([dx, dy]): [number, number] => [
    cx + dx * cos - dy * sin + alignment.offset.x,
    cy + dx * sin + dy * cos + alignment.offset.y,
  ]) as [[number, number], [number, number], [number, number], [number, number]]
}

/**
 * Render a reference floor plan image onto a Canvas 2D context with alignment.
 *
 * The image is drawn at the position and transform defined by `alignment`:
 *   1. Translated to the bounding box center
 *   2. Rotated by `alignment.rotation` degrees clockwise
 *   3. Scaled by `alignment.scale`
 *   4. Offset by `alignment.offset`
 *
 * The image is drawn with `alignment.opacity` for raster transparency.
 *
 * @param ctx - Canvas 2D rendering context
 * @param image - The HTMLImageElement or HTMLCanvasElement to draw
 * @param alignment - Plan alignment parameters (offset, scale, rotation, opacity)
 * @param bbox - The bounding box in canvas space that the image is aligned to
 * @param style - Optional rendering style overrides
 */
export function renderReferenceImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLCanvasElement,
  alignment: PlanAlignment,
  bbox: { x: number; y: number; width: number; height: number },
  style?: Partial<ReferenceImageStyle>,
): void {
  const merged = { ...DEFAULT_REFERENCE_IMAGE_STYLE, ...style }

  const corners = computeImageCorners(bbox, alignment)
  const [tl, tr, br, bl] = corners

  ctx.save()

  // Set opacity (alignment.opacity controls raster, style.opacity is an additional multiplier)
  ctx.globalAlpha = alignment.opacity * merged.opacity

  // Draw the image as a transformed quad using setTransform
  // We need a 2D affine transform from source rectangle to destination quad
  // Source: (0,0) → (imgW,0) → (imgW,imgH) → (0,imgH)
  // Dest: tl → tr → br → bl
  const imgW = image.width
  const imgH = image.height

  // Solve for the affine transform matrix [a, b, c, d, e, f]
  // where: destX = a*srcX + c*srcY + e
  //        destY = b*srcX + d*srcY + f
  //
  // Using three point correspondences:
  //   (0,0) → tl  =>  e = tl[0], f = tl[1]
  //   (w,0) → tr  =>  a*w + e = tr[0]  =>  a = (tr[0]-tl[0])/w
  //                     b*w + f = tr[1]  =>  b = (tr[1]-tl[1])/w
  //   (0,h) → bl  =>  c*h + e = bl[0]  =>  c = (bl[0]-tl[0])/h
  //                     d*h + f = bl[1]  =>  d = (bl[1]-tl[1])/h
  const a = (tr[0] - tl[0]) / imgW
  const b = (tr[1] - tl[1]) / imgW
  const c = (bl[0] - tl[0]) / imgH
  const d = (bl[1] - tl[1]) / imgH
  const e = tl[0]
  const f = tl[1]

  ctx.setTransform(a, b, c, d, e, f)
  ctx.drawImage(image, 0, 0, imgW, imgH)

  // Reset transform for border drawing
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  // Optional border
  if (merged.borderWidth > 0) {
    ctx.beginPath()
    ctx.moveTo(tl[0], tl[1])
    ctx.lineTo(tr[0], tr[1])
    ctx.lineTo(br[0], br[1])
    ctx.lineTo(bl[0], bl[1])
    ctx.closePath()
    ctx.lineWidth = merged.borderWidth
    ctx.strokeStyle = merged.borderColor
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Clear the area under a reference image by filling the bounding quad
 * with the canvas background color.
 *
 * Useful for redrawing a reference image that may have changed.
 *
 * @param ctx - Canvas 2D rendering context
 * @param alignment - Plan alignment parameters
 * @param bbox - The bounding box in canvas space
 * @param fillColor - The background color to fill with (default: white)
 */
export function clearReferenceArea(
  ctx: CanvasRenderingContext2D,
  alignment: PlanAlignment,
  bbox: { x: number; y: number; width: number; height: number },
  fillColor: string = '#FFFFFF',
): void {
  const corners = computeImageCorners(bbox, alignment)
  const [tl, tr, br, bl] = corners

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(tl[0], tl[1])
  ctx.lineTo(tr[0], tr[1])
  ctx.lineTo(br[0], br[1])
  ctx.lineTo(bl[0], bl[1])
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.restore()
}
