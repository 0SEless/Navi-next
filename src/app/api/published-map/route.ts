import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * GET /api/published-map?campus_id=asu-ibajay
 *
 * Public read endpoint that returns compiled NavigationArtifacts from the
 * Supabase `published_maps` table.
 *
 * This is the primary contract for published maps in the NAVI runtime.
 */
async function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const campusId = searchParams.get('campus_id')

  if (!campusId) {
    return NextResponse.json({ success: false, message: 'campus_id is required' }, { status: 400 })
  }

  try {
    const supabase = await getSupabaseClient()
    if (!supabase) {
      return NextResponse.json({ success: false, message: 'Supabase client unavailable' }, { status: 500 })
    }

    const { data, error } = await supabase
      .from('published_maps')
      .select('campus_id, revision, compiler_version, artifacts, published_at')
      .eq('campus_id', campusId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 })
    }

    if (!data || !data.artifacts) {
      return NextResponse.json({ success: false, message: 'No published map found for this campus' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      campusId: data.campus_id,
      revision: data.revision,
      compilerVersion: data.compiler_version,
      publishedAt: data.published_at,
      artifacts: data.artifacts,
    })
  } catch (err) {
    return NextResponse.json({ success: false, message: (err as Error).message }, { status: 500 })
  }
}
