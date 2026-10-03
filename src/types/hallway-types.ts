import type { LatLng, Component } from './nav-types'

export interface StraightSegment {
  type: 'straight'
}

export interface ArcSegment {
  type: 'arc'
  radius: number
  direction: 'cw' | 'ccw'
}

export type HallwaySegment = StraightSegment | ArcSegment

export interface HallwayData {
  centerline: LatLng[]
  width: number
  segments?: (HallwaySegment | null)[] | null
}

export function isHallwayComponent(c: Component): boolean {
  return c.type === 'hallway'
}

export function extractHallwayData(c: Component): HallwayData | null {
  if (!isHallwayComponent(c)) return null
  if (!c.polygon || c.polygon.length < 2) return null

  const width = c.dimensions?.width ?? 3
  const segments: (HallwaySegment | null)[] = []
  for (let i = 0; i < c.polygon.length - 1; i++) {
    const metaSeg = c.metadata?.segments as (HallwaySegment | null)[] | undefined
    if (metaSeg && metaSeg[i]) {
      const s = metaSeg[i]
      if (s && s.type === 'arc') {
        segments.push({ type: 'arc', radius: s.radius, direction: s.direction })
      } else {
        segments.push(null)
      }
    } else {
      segments.push(null)
    }
  }

  return {
    centerline: c.polygon,
    width,
    segments: segments.some((s) => s !== null) ? segments : null,
  }
}

function metersPerDegree(lat: number): { mLat: number; mpd: number } {
  const mLat = 111320
  const mpd = 111320 * Math.cos(lat * Math.PI / 180)
  return { mLat, mpd }
}

function latLngDistance(a: LatLng, b: LatLng): number {
  const avgLat = (a.lat + b.lat) / 2
  const { mLat, mpd } = metersPerDegree(avgLat)
  const dLat = (b.lat - a.lat) * mLat
  const dLng = (b.lng - a.lng) * mpd
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

function latLngMidpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}

export interface HallwaySkeletonVertex {
  position: LatLng
  normal: LatLng
  isEndpoint: boolean
}

export interface HallwaySkeletonSegment {
  type: 'straight' | 'arc'
  startIndex: number
  endIndex: number
  start: LatLng
  end: LatLng
  midpoint: LatLng
  length: number
  bearing: number
  radius?: number
  direction?: 'cw' | 'ccw'
}

export interface HallwaySkeleton {
  centerline: LatLng[]
  width: number
  polygon: LatLng[]
  vertices: HallwaySkeletonVertex[]
  segments: HallwaySkeletonSegment[]
}

export function computeHallwaySkeleton(data: HallwayData): HallwaySkeleton | null {
  const { centerline, width } = data
  if (centerline.length < 2) return null

  const { mLat, mpd } = metersPerDegree(
    centerline.reduce((s, p) => s + p.lat, 0) / centerline.length
  )
  const polygon = computeHallwayPolygon(centerline, width)

  const vertices: HallwaySkeletonVertex[] = centerline.map((p, i) => {
    let angle: number
    if (i === 0) {
      angle = Math.atan2(
        (centerline[1].lat - p.lat) * mLat,
        (centerline[1].lng - p.lng) * mpd
      )
    } else if (i === centerline.length - 1) {
      angle = Math.atan2(
        (p.lat - centerline[i - 1].lat) * mLat,
        (p.lng - centerline[i - 1].lng) * mpd
      )
    } else {
      const aIn = Math.atan2(
        (p.lat - centerline[i - 1].lat) * mLat,
        (p.lng - centerline[i - 1].lng) * mpd
      )
      const aOut = Math.atan2(
        (centerline[i + 1].lat - p.lat) * mLat,
        (centerline[i + 1].lng - p.lng) * mpd
      )
      const x = Math.cos(aIn) + Math.cos(aOut)
      const y = Math.sin(aIn) + Math.sin(aOut)
      angle = Math.atan2(y, x)
    }
    const perp = angle + Math.PI / 2
    return {
      position: p,
      normal: { lat: Math.sin(perp) / mLat, lng: Math.cos(perp) / mpd },
      isEndpoint: i === 0 || i === centerline.length - 1,
    }
  })

  const segments: HallwaySkeletonSegment[] = []
  for (let i = 0; i < centerline.length - 1; i++) {
    const start = centerline[i]
    const end = centerline[i + 1]
    const bearing = Math.atan2(
      (end.lat - start.lat) * mLat,
      (end.lng - start.lng) * mpd
    )
    const segType = data.segments?.[i]
    segments.push({
      type: segType && segType.type === 'arc' ? 'arc' : 'straight',
      startIndex: i,
      endIndex: i + 1,
      start,
      end,
      midpoint: latLngMidpoint(start, end),
      length: latLngDistance(start, end),
      bearing,
      ...(segType && segType.type === 'arc' ? { radius: segType.radius, direction: segType.direction } : {}),
    })
  }

  return { centerline, width, polygon, vertices, segments }
}

export function computeHallwayPolygon(centerline: LatLng[], width: number): LatLng[] {
  if (centerline.length < 2) return centerline
  const hw = width / 2
  const avgLat = centerline.reduce((s, p) => s + p.lat, 0) / centerline.length
  const mpd = 111320 * Math.cos(avgLat * Math.PI / 180)
  const mLat = 111320

  const offsets: { lat: number; lng: number }[] = []
  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i]
    let angle: number

    if (i === 0) {
      angle = Math.atan2(
        (centerline[1].lat - p.lat) * mLat,
        (centerline[1].lng - p.lng) * mpd
      )
    } else if (i === centerline.length - 1) {
      angle = Math.atan2(
        (p.lat - centerline[i - 1].lat) * mLat,
        (p.lng - centerline[i - 1].lng) * mpd
      )
    } else {
      const aIn = Math.atan2(
        (p.lat - centerline[i - 1].lat) * mLat,
        (p.lng - centerline[i - 1].lng) * mpd
      )
      const aOut = Math.atan2(
        (centerline[i + 1].lat - p.lat) * mLat,
        (centerline[i + 1].lng - p.lng) * mpd
      )
      const x = Math.cos(aIn) + Math.cos(aOut)
      const y = Math.sin(aIn) + Math.sin(aOut)
      angle = Math.atan2(y, x)
    }

    const perp = angle + Math.PI / 2
    offsets.push({
      lat: (hw / mLat) * Math.sin(perp),
      lng: (hw / mpd) * Math.cos(perp),
    })
  }

  const left = centerline.map((p, i) => ({ lat: p.lat + offsets[i].lat, lng: p.lng + offsets[i].lng }))
  const right = centerline.map((p, i) => ({ lat: p.lat - offsets[i].lat, lng: p.lng - offsets[i].lng }))
  return [...left, ...right.reverse()]
}
