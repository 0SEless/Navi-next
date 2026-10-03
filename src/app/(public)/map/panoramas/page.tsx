'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { usePublicStore } from '@/store/public-store'
import { TourViewer } from '@/components/tour/TourViewer'
import type { TourPanorama } from '@/components/tour/types'
import type { PanoramaEntry } from '@navi/core'
import { getAvailablePanoramas } from '@/lib/explore-contracts'

// Convert published PanoramaEntry to TourViewer format
function toTourPanorama(panorama: PanoramaEntry): TourPanorama {
  return {
    id: panorama.id,
    label: panorama.title || panorama.id,
    imageUrl: panorama.imageAssetId,
    heading: panorama.heading,
    hotspots: panorama.hotspots.map((h, index) => ({
      id: `${panorama.id}_hotspot_${index}_${h.yaw}_${h.pitch}`,
      type: h.hotspotType || h.type || 'navigation',
      yaw: h.yaw,
      pitch: h.pitch,
      label: h.label || `Hotspot ${index + 1}`,
      targetPanoramaId: h.type === 'navigation' ? h.target : undefined,
      content: h.content,
    })),
  }
}

export default function PanoramasPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center text-sm text-[var(--navi-text-secondary)]">
        Loading panoramas…
      </div>
    }>
      <PanoramasPageContent />
    </Suspense>
  )
}

function PanoramasPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const campus = usePublicStore((s) => s.campus)
  const campusLoading = usePublicStore((s) => s.campusLoading)
  const campusError = usePublicStore((s) => s.campusError)
  const fetchCampusData = usePublicStore((s) => s.fetchCampusData)
  const [currentIndex, setCurrentIndex] = useState(0)
  const requestedBuildingId = searchParams.get('building_id')
  const requestedPanoramaId = searchParams.get('panorama_id')

  useEffect(() => {
    if (!campus && !campusLoading && !campusError) void fetchCampusData()
  }, [campus, campusLoading, campusError, fetchCampusData])

  const panoramas = useMemo(() => {
    if (!campus) return []
    const available = getAvailablePanoramas(campus, requestedBuildingId)
    if (!requestedPanoramaId) return available
    return available.filter(panorama => panorama.id === requestedPanoramaId)
  }, [campus, requestedBuildingId, requestedPanoramaId])

  const tourPanoramas = useMemo(() => {
    return panoramas.map(toTourPanorama)
  }, [panoramas])
  const safeCurrentIndex = Math.min(currentIndex, Math.max(tourPanoramas.length - 1, 0))

  if (campusError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="text-sm text-gray-500">
          Couldn&apos;t load the campus data.
        </div>
        <div className="text-xs text-red-500">{campusError}</div>
        <button
          type="button"
          onClick={() => void fetchCampusData()}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          aria-label="Retry loading panoramas"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!campus || campusLoading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-label="Loading panoramas">
        <div className="text-sm text-gray-500">Loading panoramas...</div>
      </div>
    )
  }

  if (tourPanoramas.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No 360 Tour Available</h2>
          <p className="text-sm text-gray-500">
            This campus doesn&apos;t have any 360 panoramas published yet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-blue-600 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-white">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold">360° Virtual Tour</h1>
          <p className="text-sm text-gray-500">
            {tourPanoramas.length} panoramas available
          </p>
        </div>
      </div>

      {/* Viewer */}
      <div className="flex-1 min-h-0">
        <TourViewer
          panoramas={tourPanoramas}
          initialIndex={safeCurrentIndex}
          onPanoramaChange={setCurrentIndex}
        />
      </div>
    </div>
  )
}
