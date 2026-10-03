import { NextRequest, NextResponse } from 'next/server'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

interface OverpassNode {
  type: 'node'
  id: number
  lat: number
  lon: number
}

interface OverpassWay {
  type: 'way'
  id: number
  tags?: Record<string, string>
  center?: { lat: number; lon: number }
  geometry?: { lat: number; lon: number }[]
  nodes: number[]
}

interface OverpassResponse {
  version: number
  generator: string
  elements: (OverpassNode | OverpassWay)[]
  remark?: string
}

type BuildingResult = {
  id: string
  name: string
  footprint: { lat: number; lng: number }[]
  height: number
  color: string
  center: { lat: number; lng: number }
  levels?: number
  rawTags: Record<string, string>
}

function parseElements(elements: OverpassResponse['elements']): BuildingResult[] {
  const buildings: BuildingResult[] = []
  for (const el of elements) {
    if (el.type !== 'way') continue
    if (!el.tags) continue
    if (!el.geometry || el.geometry.length < 3) continue

    const levels = parseInt(el.tags['building:levels'] || '1', 10)
    const height = el.tags['height']
      ? parseFloat(el.tags['height'])
      : levels * 3 + 2

    const color = el.tags['building:colour'] || el.tags['roof:colour'] || '#1C6BEB'
    const name = el.tags['name'] || el.tags['amenity'] || el.tags['building'] || `Building ${el.id}`

    const footprint = el.geometry.map((p) => ({ lat: p.lat, lng: p.lon }))
    const centerLat = el.center?.lat ?? footprint.reduce((s, p) => s + p.lat, 0) / footprint.length
    const centerLng = el.center?.lon ?? footprint.reduce((s, p) => s + p.lng, 0) / footprint.length

    buildings.push({
      id: `osm-bldg-${el.id}`,
      name,
      footprint,
      height: isNaN(height) ? 15 : height,
      color,
      center: { lat: centerLat, lng: centerLng },
      levels: isNaN(levels) ? undefined : levels,
      rawTags: el.tags,
    })
  }
  return buildings
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get('lat') || '11.8195')
  const lng = parseFloat(searchParams.get('lng') || '122.0922')
  const radius = parseFloat(searchParams.get('radius') || '0.02')

  const bbox = `${lat - radius},${lng - radius},${lat + radius},${lng + radius}`
  const query = `[out:json][timeout:25];
(way["building"](${bbox}););
out center tags geom;`

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'NAVI/0.1',
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Overpass returned ${res.status}`, raw: await res.text() }, { status: 502 })
    }

    const raw: OverpassResponse = await res.json()
    const buildings = parseElements(raw.elements)

    return NextResponse.json({
      query: { lat, lng, radius, bbox },
      raw: {
        elements: raw.elements.length,
        remark: raw.remark || null,
      },
      buildings,
      count: buildings.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const boundary: { lat: number; lng: number }[] = body.boundary

    if (!boundary || boundary.length < 3) {
      return NextResponse.json({ error: 'Boundary must have at least 3 points' }, { status: 400 })
    }

    const poly = boundary.map((p) => `${p.lat} ${p.lng}`).join(' ')
    const query = `[out:json][timeout:30];
(way["building"](poly:"${poly}"););
out center tags geom;`

    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'NAVI/0.1',
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Overpass returned ${res.status}`, raw: await res.text() }, { status: 502 })
    }

    const raw: OverpassResponse = await res.json()
    const buildings = parseElements(raw.elements)

    return NextResponse.json({
      query: { boundaryPoints: boundary.length },
      raw: {
        elements: raw.elements.length,
        remark: raw.remark || null,
      },
      buildings,
      count: buildings.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
