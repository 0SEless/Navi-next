export interface Point2D {
  x: number
  y: number
}

export interface StaircaseGraphics<T extends Point2D> {
  outline: T[]
  treads: T[][]
  arrow: T[]
}

export interface ElevatorGraphics<T extends Point2D> {
  shaftOutline: T[]
  cabinOutline: T[]
  doorLines: T[][]
}

function interpolate<T extends Point2D>(a: T, b: T, t: number): T {
  return {
    ...a,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  } as T
}

function interpolateLatLng(a: { lat: number; lng: number }, b: { lat: number; lng: number }, t: number) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  }
}

/**
 * Generate architectural staircase graphic elements (parallel tread steps and walk arrow)
 * from a 4-point polygon or rectangle.
 */
export function generateStairGraphicsLatLng(
  polygonPoints: Array<{ lat: number; lng: number }>,
  stepCount = 8
): { outline: Array<{ lat: number; lng: number }>; treads: Array<Array<{ lat: number; lng: number }>>; arrow: Array<{ lat: number; lng: number }> } {
  if (polygonPoints.length < 4) {
    return { outline: polygonPoints, treads: [], arrow: [] }
  }

  const p0 = polygonPoints[0]
  const p1 = polygonPoints[1]
  const p2 = polygonPoints[2]
  const p3 = polygonPoints[3]

  const treads: Array<Array<{ lat: number; lng: number }>> = []
  const count = Math.max(3, Math.min(20, stepCount))

  for (let i = 1; i < count; i++) {
    const t = i / count
    const left = interpolateLatLng(p0, p3, t)
    const right = interpolateLatLng(p1, p2, t)
    treads.push([left, right])
  }

  // Walk arrow along centerline
  const startMid = interpolateLatLng(p0, p1, 0.5)
  const endMid = interpolateLatLng(p3, p2, 0.5)
  const arrowTip = interpolateLatLng(startMid, endMid, 0.85)
  const arrowBase = interpolateLatLng(startMid, endMid, 0.15)

  // Arrowhead wings
  const wingLeft = interpolateLatLng(interpolateLatLng(p0, p3, 0.65), interpolateLatLng(p1, p2, 0.65), 0.3)
  const wingRight = interpolateLatLng(interpolateLatLng(p0, p3, 0.65), interpolateLatLng(p1, p2, 0.65), 0.7)

  const arrow = [arrowBase, arrowTip, wingLeft, arrowTip, wingRight]

  return {
    outline: polygonPoints,
    treads,
    arrow,
  }
}

/**
 * Generate architectural elevator graphic elements (shaft, cabin inset box, and door marker)
 * from a polygon or rectangle.
 */
export function generateElevatorGraphicsLatLng(
  polygonPoints: Array<{ lat: number; lng: number }>,
  insetRatio = 0.8
): { shaftOutline: Array<{ lat: number; lng: number }>; cabinOutline: Array<{ lat: number; lng: number }>; doorLines: Array<Array<{ lat: number; lng: number }>> } {
  if (polygonPoints.length < 4) {
    return { shaftOutline: polygonPoints, cabinOutline: [], doorLines: [] }
  }

  let centerLat = 0
  let centerLng = 0
  for (let i = 0; i < 4; i++) {
    centerLat += polygonPoints[i].lat
    centerLng += polygonPoints[i].lng
  }
  centerLat /= 4
  centerLng /= 4
  const center = { lat: centerLat, lng: centerLng }

  // Inset cabin points
  const cabinOutline: Array<{ lat: number; lng: number }> = []
  for (let i = 0; i < 4; i++) {
    cabinOutline.push(interpolateLatLng(center, polygonPoints[i], insetRatio))
  }
  cabinOutline.push(cabinOutline[0]) // close polygon

  // Door double-lines on front edge (p0 -> p1)
  const p0 = polygonPoints[0]
  const p1 = polygonPoints[1]
  const door1A = interpolateLatLng(p0, p1, 0.2)
  const door1B = interpolateLatLng(p0, p1, 0.45)
  const door2A = interpolateLatLng(p0, p1, 0.55)
  const door2B = interpolateLatLng(p0, p1, 0.8)

  const doorLines = [
    [door1A, door1B],
    [door2A, door2B],
  ]

  return {
    shaftOutline: polygonPoints,
    cabinOutline,
    doorLines,
  }
}
