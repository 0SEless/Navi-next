import { useCallback } from 'react'
import { planFileToRasterDataUrl, SUPPORTED_PLAN_ACCEPT } from './plan-upload'

const INPUT_ID = 'fpu-input'

interface FloorPlanUploadProps {
  /** Current floor plan image URL (from floor.planImageId) */
  imageUrl?: string | null
  /** Current floor plan state */
  state?: 'none' | 'active' | 'locked' | null
  /** Called when a new floor plan image is uploaded */
  onUpload: (dataUrl: string, dimensions?: FloorPlanImageDimensions) => void
  /** Called to remove the floor plan */
  onRemove: () => void
  /** Whether the floor plan is locked (geometry depends on it) */
  locked?: boolean
}

export interface FloorPlanImageDimensions {
  width: number
  height: number
}

function readImageDimensions(dataUrl: string): Promise<FloorPlanImageDimensions | undefined> {
  if (typeof Image === 'undefined') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      resolve(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : undefined)
    }
    image.onerror = () => resolve(undefined)
    image.src = dataUrl
  })
}

const btnStyle: React.CSSProperties = {
  display: 'block',
  background: '#094771',
  border: 'none',
  color: '#fff',
  borderRadius: 4,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 11,
  width: '100%',
  textAlign: 'center',
}

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 10,
  cursor: 'pointer',
  padding: 0,
  textAlign: 'left',
  textDecoration: 'underline',
}

/**
 * Reusable floor plan upload component.
 *
 * Handles file selection → FileReader → data URL, thumbnail preview,
 * replace/remove actions, and lifecycle state display.
 *
 * Usage:
 * ```
 * <FloorPlanUpload
 *   imageUrl={floor.planImageId}
 *   state={floor.floorPlanState}
 *   onUpload={(dataUrl) => handleUpdateMeta(floor.id, {
 *     planImageId: dataUrl,
 *     floorPlanState: 'active',
 *   })}
 *   onRemove={() => handleUpdateMeta(floor.id, {
 *     planImageId: null,
 *     floorPlanState: 'none',
 *   })}
 * />
 * ```
 */
export function FloorPlanUpload({ imageUrl, state, onUpload, onRemove, locked }: FloorPlanUploadProps) {
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      // P1-T14 (R4.3): PDFs are rasterized (lazy PDF.js) into the same PNG
      // pipeline; raster uploads pass through unchanged.
      const url = await planFileToRasterDataUrl(file)
      onUpload(url, await readImageDimensions(url))
    } catch (err) {
      console.error('FloorPlanUpload: failed to process file', err)
    }
    e.target.value = ''
  }, [onUpload])

  const stateLabel = state ?? 'none'

  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748B', marginBottom: 4 }}>FLOOR PLAN</div>
      <input id={INPUT_ID} type="file" accept={SUPPORTED_PLAN_ACCEPT}
        onChange={handleFileChange} style={{ display: 'none' }} />

      {stateLabel === 'active' && imageUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <img src={imageUrl} alt="Floor plan"
            style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', border: '1px solid #334155' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#4ADE80' }}>✓ Uploaded</span>
            <label htmlFor={INPUT_ID} style={{ ...linkStyle, color: '#94A3B8' }}>
              Replace
            </label>
            {!locked && (
              <button onClick={onRemove} style={{ ...linkStyle, color: '#EF4444' }}>
                Remove
              </button>
            )}
          </div>
        </div>
      ) : stateLabel === 'locked' ? (
        <div style={{ fontSize: 11, color: '#94A3B8', padding: '4px 0' }}>
          🔒 Locked (geometry depends on it)
        </div>
      ) : (
        <label htmlFor={INPUT_ID} style={btnStyle}>
          + Upload
        </label>
      )}
    </div>
  )
}
