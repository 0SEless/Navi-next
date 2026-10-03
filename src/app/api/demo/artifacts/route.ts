import { NextResponse } from 'next/server'

/**
 * GET /api/demo/artifacts
 * 
 * DEPRECATED: Demo artifacts have been removed.
 * This route now returns 404 for all requests.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Demo artifacts are no longer available' },
    { status: 404 },
  )
}
