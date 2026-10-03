'use client'

import { use, useEffect } from 'react'

import { StudioCaptureLibrary } from '@/features/capture-library/components/StudioCaptureLibrary'
import { SupabaseCaptureSyncProvider } from '@/features/capture-sync/SupabaseCaptureSyncProvider'
import { useCampusMapStore } from '@/store/campus-map-store'

export default function StudioCaptureLibraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const load = useCampusMapStore((state) => state.load)
  const maps = useCampusMapStore((state) => state.maps)
  const campusMap = maps.find((map) => map.id === id)

  useEffect(() => {
    load()
  }, [load])

  if (!campusMap) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navi-text-secondary)', fontSize: 13 }}>Map not found</div>
  }

  const campusLabel = campusMap.campusName ? `${campusMap.name} · ${campusMap.campusName}` : campusMap.name

  return (
    <SupabaseCaptureSyncProvider>
      <StudioCaptureLibrary campusId={campusMap.id} campusLabel={campusLabel} />
    </SupabaseCaptureSyncProvider>
  )
}
