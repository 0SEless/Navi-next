// ── P1-T14 (R4.3): floor-plan upload contract + PDF rasterization ──
// PDFs are accepted for plan upload and rendered as a REFERENCE LAYER via
// client-side PDF.js LAZY rasterization (the pdfjs-dist module is dynamically
// imported only when a PDF is actually uploaded). The rasterized PNG flows
// through the EXACT existing plan-image pipeline (planImageId + planAlignment)
// — planAlignment remains the only reference transform (D5/R4.3).
// Raster uploads (png/jpeg/webp) pass through UNCHANGED.

export const SUPPORTED_PLAN_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const

/** accept attribute value for plan upload inputs (rasters + PDF). */
export const SUPPORTED_PLAN_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.pdf'

/** Resolution cap for PDF rasterization (validation item: resolution cap). */
export const PLAN_RASTER_MAX_DIMENSION_PX = 2000

const PDF_EXTENSIONS = ['.pdf']
const RASTER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

/** True when a file must be rasterized before entering the plan pipeline. */
export function needsRasterization(file: { name?: string; type?: string }): boolean {
  const name = file.name?.toLowerCase() ?? ''
  const ext = name.slice(name.lastIndexOf('.'))
  if (PDF_EXTENSIONS.includes(ext)) return true
  if (file.type === 'application/pdf') return true
  return false
}

/** True when the file is an accepted plan upload (PDF OR raster). */
export function isSupportedPlanFile(file: { name?: string; type?: string }): boolean {
  const name = file.name?.toLowerCase() ?? ''
  const ext = name.slice(name.lastIndexOf('.'))
  if ([...PDF_EXTENSIONS, ...RASTER_EXTENSIONS].includes(ext)) return true
  return (SUPPORTED_PLAN_MIME as readonly string[]).includes(file.type ?? '')
}

export interface RenderScale {
  scale: number
  width: number
  height: number
}

/**
 * Pure sizing math for PDF rasterization: the largest dimension is capped at
 * PLAN_RASTER_MAX_DIMENSION_PX, aspect ratio preserved, integer pixels.
 * Pages already within the cap render at scale 1.
 */
export function capRenderScale(
  pageWidth: number,
  pageHeight: number,
  maxPx: number = PLAN_RASTER_MAX_DIMENSION_PX,
): RenderScale {
  const largest = Math.max(pageWidth, pageHeight)
  const scale = largest > 0 ? Math.min(1, maxPx / largest) : 1
  return {
    scale,
    width: Math.max(1, Math.round(pageWidth * scale)),
    height: Math.max(1, Math.round(pageHeight * scale)),
  }
}

/**
 * Rasterize a PDF file into a PNG data URL using lazily-imported PDF.js.
 * Browser-only (canvas rendering); page 1 only, resolution capped.
 * Never called for raster uploads — needsRasterization gates it.
 */
export async function rasterizePdfToPng(
  file: File | Blob,
  maxPx: number = PLAN_RASTER_MAX_DIMENSION_PX,
): Promise<string> {
  // Lazy: pdfjs-dist is only fetched when a PDF is actually uploaded.
  const pdfjs = await import('pdfjs-dist')
  const data = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise
  try {
    const page = await doc.getPage(1)
    const viewport1 = page.getViewport({ scale: 1 })
    const { scale, width, height } = capRenderScale(viewport1.width, viewport1.height, maxPx)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('PDF rasterization: canvas 2d context unavailable')

    // v6 typing: render params are the function's own parameter type.
    await page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise
    return canvas.toDataURL('image/png')
  } finally {
    await loadingTask.destroy()
  }
}

/**
 * Turn any supported plan file into a raster data URL ready for
 * planImageId: PDFs are rasterized (lazy PDF.js), rasters pass through
 * unchanged (FileReader → data URL — the pre-P1-T14 behavior).
 */
export async function planFileToRasterDataUrl(file: File | Blob): Promise<string> {
  if (needsRasterization(file)) {
    return rasterizePdfToPng(file)
  }
  return readFileAsDataUrl(file)
}

function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}