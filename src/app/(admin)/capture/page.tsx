import { use } from 'react'
import { CapturePageClient } from './CapturePageClient'

type CapturePageSearchParams = {
  campusId?: string | string[]
}

export default function CapturePage({
  searchParams,
}: {
  searchParams?: Promise<CapturePageSearchParams>
}) {
  const params = searchParams ? use(searchParams) : {}
  const campusId = Array.isArray(params.campusId) ? params.campusId[0] : params.campusId

  return <CapturePageClient key={campusId ?? 'none'} initialCampusId={campusId ?? null} />
}
