import { createClient } from '@/lib/supabase-client'
import { needsRasterization, rasterizePdfToPng } from '@navi/editor'
import { isOwnedFloorPlanUrl } from './floor-plan-lifecycle'
import type { FloorPlanStorageScope } from './floor-plan-lifecycle'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

/** P1-T14 (R4.3): PDFs are rasterized client-side (lazy PDF.js) into a PNG
 *  BEFORE upload — the reference layer is always a raster so alignment and
 *  publish flow through the existing pipeline unchanged (D5). */
async function planFileToUploadBlob(file: File): Promise<File> {
  if (!needsRasterization(file)) return file
  const pngDataUrl = await rasterizePdfToPng(file)
  const base64 = pngDataUrl.split(',')[1] ?? ''
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return new File([bytes], (file.name.replace(/\.pdf$/i, '') || 'floor-plan') + '.png', { type: 'image/png' })
}

export async function uploadFloorPlanImage(
  file: File,
  mapId: string,
  buildingId: string,
  floorLevel: number,
): Promise<string> {
  // P1-T14: rasterize PDFs first so storage/data-url paths never carry a PDF.
  const uploadFile = await planFileToUploadBlob(file)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return readFileAsDataUrl(uploadFile)
  }

  try {
    const supabase = createClient()
    const fileExt = uploadFile.name?.split('.').pop() || 'png'
    const fileName = `${mapId}/${buildingId}/floor-${floorLevel}-${Date.now()}.${fileExt}`

    const { data, error } = await supabase.storage
      .from('floor-plans')
      .upload(fileName, uploadFile, {
        cacheControl: '3600',
        upsert: true,
      })

    if (error || !data?.path) {
      console.warn('Supabase storage upload error, falling back to data URL:', error?.message)
      return readFileAsDataUrl(uploadFile)
    }

    const { data: publicUrlData } = supabase.storage
      .from('floor-plans')
      .getPublicUrl(data.path)

    return publicUrlData.publicUrl || readFileAsDataUrl(uploadFile)
  } catch (err) {
    console.warn('Storage exception, falling back to data URL:', String(err))
    return readFileAsDataUrl(uploadFile)
  }
}

export interface DeleteFloorPlanImageOptions {
  /**
   * Authoritative floor-plan URLs still referenced after the update that
   * triggered this deletion (see `collectBuildingFloorPlanReferences`).
   * If the target URL appears here the asset is SHARED: deletion is skipped
   * safely (return, no throw — a shared asset is an expected condition, not
   * an error). Reference existence takes precedence over storage-path
   * ownership: a `floor-N-` prefix proves namespace, never exclusivity.
   */
  referencedUrls?: readonly (string | null | undefined)[]
}

export async function deleteFloorPlanImage(
  url: string,
  scope?: FloorPlanStorageScope,
  options?: DeleteFloorPlanImageOptions,
): Promise<void> {
  // Reference guard FIRST: a floor-plan asset may only be physically deleted
  // when NO authoritative floor-plan reference resolves to it.
  if (options?.referencedUrls?.some((referenced) => referenced != null && referenced === url)) {
    return
  }
  // Destructive storage cleanup is allowed only after ownership is proven.
  if (!scope || !isOwnedFloorPlanUrl(url, scope)) return
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return

  try {
    const supabase = createClient()
    const parsed = new URL(url)
    const marker = '/storage/v1/object/public/floor-plans/'
    const encodedPath = parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length)
    const filePath = decodeURIComponent(encodedPath)
    if (!filePath || filePath.includes('..')) return
    await supabase.storage.from('floor-plans').remove([filePath])
  } catch (err) {
    console.warn('Failed to delete floor plan image:', String(err))
  }
}
