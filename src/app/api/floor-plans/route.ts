import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedMutationAuth } from '@/lib/api-guard'

export async function POST(request: NextRequest) {
  const unauthorized = await requireVerifiedMutationAuth(request)
  if (unauthorized) return unauthorized
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const buildingId = formData.get('buildingId') as string | null
    const floorStr = formData.get('floor') as string | null

    if (!file || !buildingId || !floorStr) {
      return NextResponse.json(
        { error: 'Missing required fields: file, buildingId, floor' },
        { status: 400 }
      )
    }

    const floor = parseInt(floorStr, 10)
    if (isNaN(floor)) {
      return NextResponse.json({ error: 'Floor must be a number' }, { status: 400 })
    }

    // V1: Convert to base64 data URL (for local dev / demo)
    // Replace with Cloudinary/Supabase upload in production
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = file.type || 'image/png'
    const dataUrl = `data:${mimeType};base64,${base64}`

    return NextResponse.json({
      url: dataUrl,
      buildingId,
      floor,
      fileName: file.name,
      size: file.size,
    })
  } catch (error) {
    console.error('Floor plan upload failed:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

