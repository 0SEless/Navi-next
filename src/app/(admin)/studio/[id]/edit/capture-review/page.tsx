'use client'

import { use, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { EditorBridge } from '@/components/studio/EditorBridge'
import { SupabaseCaptureSyncProvider } from '@/features/capture-sync/SupabaseCaptureSyncProvider'
import { useGraphStore } from '@/store/graph-store'
import { useCampusMapStore } from '@/store/campus-map-store'
import { StudioCaptureReviewer } from '@/features/capture-review/components/StudioCaptureReviewer'

export default function StudioCaptureImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const sessionId = useSearchParams().get('sessionId')
  const loadMapData = useGraphStore((state) => state.loadMapData)
  const currentMapId = useGraphStore((state) => state.currentMapId)
  const maps = useCampusMapStore((state) => state.maps)
  const campusMap = maps.find((map) => map.id === id)

  useEffect(() => {
    if (currentMapId !== id) loadMapData(id)
  }, [currentMapId, id, loadMapData])

  if (!campusMap) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navi-text-secondary)', fontSize: 13 }}>Map not found</div>
  }

  if (currentMapId !== id) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navi-text-secondary)', fontSize: 13 }}>Loading map…</div>
  }

  return (
    <SupabaseCaptureSyncProvider>
      <EditorBridge>
        <StudioCaptureReviewer campusMap={campusMap} remoteSessionId={sessionId} />
      </EditorBridge>
    </SupabaseCaptureSyncProvider>
  )
}
