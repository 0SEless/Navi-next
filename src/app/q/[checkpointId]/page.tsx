import { notFound, redirect } from 'next/navigation'
import { isStableQrId } from '@/lib/qr-payload'

interface QrCheckpointRedirectPageProps {
  params: Promise<{ checkpointId: string }>
}

export default async function QrCheckpointRedirectPage({ params }: QrCheckpointRedirectPageProps) {
  const { checkpointId } = await params
  if (!isStableQrId(checkpointId)) return notFound()
  redirect(`/map/navigate?qr=${encodeURIComponent(checkpointId)}`)
}
