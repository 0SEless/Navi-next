'use client'

import { useState, useMemo, useCallback } from 'react'
import { useEditor } from '@navi/editor'
import type { Panorama } from '@navi/core'
import { TourViewer } from '@/components/tour/TourViewer'
import { validatePanoramaCoordinates, validatePanoramaHotspots } from '@navi/core'
import type { TourPanorama } from '@/components/tour/types'

interface Tour360PreviewProps {
  isOpen: boolean
  onClose: () => void
  initialPanoramaId?: string
}

// Convert NAVI Panorama to TourViewer format
function toTourPanorama(panorama: Panorama, allPanoramaIds: string[]): TourPanorama {
  return {
    id: panorama.id,
    label: panorama.label || panorama.id,
    imageUrl: panorama.imageAssetId || `https://picsum.photos/seed/${panorama.id}/2048/1024`,
    heading: panorama.heading,
    hotspots: panorama.hotspots.map((h, index) => ({
      id: `${panorama.id}_hotspot_${index}_${h.position.yaw}_${h.position.pitch}`,
      type: h.hotspotType || 'navigation',
      yaw: h.position.yaw,
      pitch: h.position.pitch,
      label: h.label || `Hotspot ${index + 1}`,
      targetPanoramaId: h.target.type === 'panorama' ? h.target.targetId : undefined,
      content: h.content,
    })),
  }
}

export function Tour360Preview({ isOpen, onClose, initialPanoramaId }: Tour360PreviewProps) {
  const { document } = useEditor()
  const [currentIndex, setCurrentIndex] = useState(0)

  // Get all panoramas
  const allPanoramas = useMemo(() => document.panoramas || [], [document])

  // Find initial panorama index
  const initialIndex = useMemo(() => {
    if (!initialPanoramaId) return 0
    const idx = allPanoramas.findIndex(p => p.id === initialPanoramaId)
    return idx >= 0 ? idx : 0
  }, [allPanoramas, initialPanoramaId])

  // Convert to TourViewer format
  const tourPanoramas = useMemo(() => {
    const allIds = allPanoramas.map(p => p.id)
    return allPanoramas.map(p => toTourPanorama(p, allIds))
  }, [allPanoramas])

  // Validate the tour
  const validationErrors = useMemo(() => {
    const errors: string[] = []
    const allIds = allPanoramas.map(p => p.id)

    for (const panorama of allPanoramas) {
      // Check coordinate validity
      const coordIssues = validatePanoramaCoordinates(panorama)
      for (const issue of coordIssues) {
        if (issue.severity === 'error') {
          errors.push(issue.message)
        }
      }

      // Check hotspot validity
      const hotspotIssues = validatePanoramaHotspots(panorama, allIds)
      for (const issue of hotspotIssues) {
        if (issue.severity === 'error') {
          errors.push(issue.message)
        }
      }
    }

    return errors
  }, [allPanoramas])

  const handlePanoramaChange = useCallback((index: number) => {
    setCurrentIndex(index)
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="text-lg font-semibold">360 Tour Preview</h3>
            <p className="text-sm text-gray-500">
              {allPanoramas.length} panoramas
              {validationErrors.length > 0 && (
                <span className="ml-2 text-red-500">
                  ({validationErrors.length} validation {validationErrors.length === 1 ? 'error' : 'errors'})
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close preview"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200">
            <p className="text-sm font-medium text-red-800 mb-1">Validation Issues:</p>
            <ul className="text-sm text-red-700 list-disc list-inside">
              {validationErrors.slice(0, 5).map((error, i) => (
                <li key={i}>{error}</li>
              ))}
              {validationErrors.length > 5 && (
                <li className="text-red-500">...and {validationErrors.length - 5} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Viewer */}
        <div className="flex-1 min-h-[400px]">
          {tourPanoramas.length > 0 ? (
            <TourViewer
              panoramas={tourPanoramas}
              initialIndex={initialIndex}
              onPanoramaChange={handlePanoramaChange}
            />
          ) : (
            <div className="flex items-center justify-center h-full bg-gray-100 text-gray-500">
              No panoramas to preview. Add panoramas in the 360 Tour editor.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {currentIndex < tourPanoramas.length
                ? `Viewing: ${tourPanoramas[currentIndex]?.label || 'Unknown'}`
                : 'Select a panorama'}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
