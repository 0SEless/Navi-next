'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { CaptureShell } from '@/features/capture/components/CaptureShell'
import type { CaptureCampusOption } from '@/features/capture/components/CaptureHome'
import { SupabaseCaptureSyncProvider } from '@/features/capture-sync/SupabaseCaptureSyncProvider'
import { useCampusMapStore } from '@/store/campus-map-store'

export interface CapturePageClientProps {
  initialCampusId?: string | null
}

function getCampusLabel(map: { name: string; campusName?: string }) {
  return map.campusName ? `${map.name} · ${map.campusName}` : map.name
}

export function CapturePageClient({ initialCampusId = null }: CapturePageClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const maps = useCampusMapStore((state) => state.maps)
  const load = useCampusMapStore((state) => state.load)
  const [selectedCampusId, setSelectedCampusId] = useState<string | null>(initialCampusId)

  useEffect(() => {
    load()
  }, [load])

  const campusOptions = useMemo<CaptureCampusOption[]>(
    () => maps.map((map) => ({ id: map.id, label: getCampusLabel(map) })),
    [maps],
  )
  const selectedCampus = maps.find((map) => map.id === selectedCampusId) ?? null

  const handleCampusChange = (nextCampusId: string | null) => {
    const canonicalCampusId = maps.find((map) => map.id === nextCampusId)?.id ?? null
    setSelectedCampusId(canonicalCampusId)

    const params = new URLSearchParams(window.location.search)
    if (canonicalCampusId) params.set('campusId', canonicalCampusId)
    else params.delete('campusId')
    const query = params.toString()
    router.replace(`${pathname || '/capture'}${query ? `?${query}` : ''}`)
  }

  return (
    <SupabaseCaptureSyncProvider>
      <CaptureShell
        campusId={selectedCampus?.id ?? null}
        campusLabel={selectedCampus ? getCampusLabel(selectedCampus) : null}
        campusOptions={campusOptions}
        onCampusChange={handleCampusChange}
      />
    </SupabaseCaptureSyncProvider>
  )
}
