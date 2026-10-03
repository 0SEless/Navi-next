'use client'

import { use } from 'react'
import { MapPreview } from '@/components/studio/MapPreview'

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <MapPreview mapId={id} />
}
