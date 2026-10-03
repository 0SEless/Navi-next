import type { Room, Hallway, Building, Floor } from '@navi/core'

export interface Wall2_5d {
  id: string
  points: { x: number; y: number }[]
  height: number
  color: string
  opacity: number
}

export interface Floor2_5d {
  id: string
  points: { x: number; y: number }[]
  color: string
  opacity: number
}

export interface Style2_5d {
  wallColor: string
  wallOpacity: number
  floorColor: string
  floorOpacity: number
  wallHeight: number
  strokeColor: string
  strokeWidth: number
  shadowOffset: { x: number; y: number }
  shadowBlur: number
  shadowColor: string
}

export const DEFAULT_STYLE_2_5D: Style2_5d = {
  wallColor: '#4A90D9',
  wallOpacity: 0.85,
  floorColor: '#87CEEB',
  floorOpacity: 0.4,
  wallHeight: 3.5,
  strokeColor: '#333333',
  strokeWidth: 1,
  shadowOffset: { x: 3, y: 3 },
  shadowBlur: 4,
  shadowColor: 'rgba(0,0,0,0.3)',
}

const CATEGORY_COLORS: Record<string, string> = {
  classroom: '#87CEEB',
  office: '#98FB98',
  lab: '#FFD700',
  restroom: '#DDA0DD',
  stairwell: '#D3D3D3',
  elevator_lobby: '#E0E0E0',
  lobby: '#F0E68C',
  storage: '#C0C0C0',
  meeting: '#ADD8E6',
  auditorium: '#FFA07A',
  server: '#FF4500',
  utility: '#808080',
  other: '#E8E8E8',
}

export function apply2_5dTransform(
  ctx: CanvasRenderingContext2D,
  tilt: number,
  rotation: number,
): void {
  const tiltRad = (tilt * Math.PI) / 180
  const rotRad = (rotation * Math.PI) / 180

  const scaleX = Math.cos(tiltRad)
  const scaleY = Math.cos(tiltRad) * 0.6

  ctx.save()
  ctx.rotate(-rotRad)
  ctx.scale(scaleX, scaleY)
}

export function reset2_5dTransform(ctx: CanvasRenderingContext2D): void {
  ctx.restore()
}

function getWallColor(room: Room): string {
  return CATEGORY_COLORS[room.category] || CATEGORY_COLORS.other
}

function roomToWalls2_5d(
  room: Room,
  height: number,
  style: Style2_5d,
): Wall2_5d[] {
  const points = room.polygon.points
  if (points.length < 3) return []

  const walls: Wall2_5d[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]

    walls.push({
      id: `${room.id}-wall-${i}`,
      points: [p1, p2],
      height,
      color: style.wallColor || getWallColor(room),
      opacity: style.wallOpacity,
    })
  }

  return walls
}

function hallwayToWalls2_5d(
  hallway: Hallway,
  height: number,
  style: Style2_5d,
): Wall2_5d[] {
  const points = hallway.polyline.points
  if (points.length < 2) return []

  const halfWidth = (hallway.width || 2) / 2
  const leftPoints: { x: number; y: number }[] = []
  const rightPoints: { x: number; y: number }[] = []

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    let dx = 0
    let dy = 1

    if (i < points.length - 1) {
      const next = points[i + 1]
      dx = next.x - p.x
      dy = next.y - p.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        dx /= len
        dy /= len
      }
    } else if (i > 0) {
      const prev = points[i - 1]
      dx = p.x - prev.x
      dy = p.y - prev.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0) {
        dx /= len
        dy /= len
      }
    }

    const nx = -dy
    const ny = dx

    leftPoints.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth })
    rightPoints.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth })
  }

  rightPoints.reverse()

  const walls: Wall2_5d[] = []

  if (leftPoints.length >= 2) {
    walls.push({
      id: `${hallway.id}-wall-left`,
      points: leftPoints,
      height,
      color: style.wallColor || '#B0C4DE',
      opacity: style.wallOpacity,
    })
  }

  if (rightPoints.length >= 2) {
    walls.push({
      id: `${hallway.id}-wall-right`,
      points: rightPoints,
      height,
      color: style.wallColor || '#B0C4DE',
      opacity: style.wallOpacity,
    })
  }

  return walls
}

export function renderWalls2_5d(
  ctx: CanvasRenderingContext2D,
  walls: Wall2_5d[],
  style: Style2_5d = DEFAULT_STYLE_2_5D,
): void {
  ctx.save()

  for (const wall of walls) {
    if (wall.points.length < 2) continue

    ctx.fillStyle = hexToRgba(wall.color, wall.opacity)
    ctx.strokeStyle = style.strokeColor
    ctx.lineWidth = style.strokeWidth

    ctx.shadowOffsetX = style.shadowOffset.x
    ctx.shadowOffsetY = style.shadowOffset.y
    ctx.shadowBlur = style.shadowBlur
    ctx.shadowColor = style.shadowColor

    ctx.beginPath()

    const basePoints = wall.points.map(p => [p.x, p.y] as [number, number])
    ctx.moveTo(basePoints[0][0], basePoints[0][1])
    for (let i = 1; i < basePoints.length; i++) {
      ctx.lineTo(basePoints[i][0], basePoints[i][1])
    }

    for (let i = basePoints.length - 1; i >= 0; i--) {
      ctx.lineTo(basePoints[i][0], basePoints[i][1] - wall.height)
    }

    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

export function renderFloor2_5d(
  ctx: CanvasRenderingContext2D,
  floors: Floor2_5d[],
  style: Style2_5d = DEFAULT_STYLE_2_5D,
): void {
  ctx.save()

  for (const floor of floors) {
    if (floor.points.length < 3) continue

    ctx.fillStyle = hexToRgba(floor.color, floor.opacity)
    ctx.strokeStyle = style.strokeColor
    ctx.lineWidth = style.strokeWidth * 0.5

    ctx.shadowOffsetX = style.shadowOffset.x * 0.5
    ctx.shadowOffsetY = style.shadowOffset.y * 0.5
    ctx.shadowBlur = style.shadowBlur * 0.5
    ctx.shadowColor = style.shadowColor

    ctx.beginPath()
    ctx.moveTo(floor.points[0].x, floor.points[0].y)
    for (let i = 1; i < floor.points.length; i++) {
      ctx.lineTo(floor.points[i].x, floor.points[i].y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

export function roomsToFloors2_5d(
  rooms: Room[],
  style: Style2_5d = DEFAULT_STYLE_2_5D,
): Floor2_5d[] {
  return rooms.map(room => ({
    id: room.id,
    points: room.polygon.points,
    color: style.floorColor || getWallColor(room),
    opacity: style.floorOpacity,
  }))
}

export function roomsToWalls2_5d(
  rooms: Room[],
  height: number,
  style: Style2_5d = DEFAULT_STYLE_2_5D,
): Wall2_5d[] {
  const allWalls: Wall2_5d[] = []
  for (const room of rooms) {
    allWalls.push(...roomToWalls2_5d(room, height, style))
  }
  return allWalls
}

export function hallwaysToWalls2_5d(
  hallways: Hallway[],
  height: number,
  style: Style2_5d = DEFAULT_STYLE_2_5D,
): Wall2_5d[] {
  const allWalls: Wall2_5d[] = []
  for (const hallway of hallways) {
    allWalls.push(...hallwayToWalls2_5d(hallway, height, style))
  }
  return allWalls
}

export function buildingToWalls2_5d(
  building: Building,
  floor: Floor,
  style: Style2_5d = DEFAULT_STYLE_2_5D,
): Wall2_5d[] {
  const height = floor.height || style.wallHeight
  const walls: Wall2_5d[] = []

  for (const room of floor.rooms) {
    walls.push(...roomToWalls2_5d(room, height, style))
  }
  for (const hallway of floor.hallways) {
    walls.push(...hallwayToWalls2_5d(hallway, height, style))
  }

  return walls
}

export function buildingToFloors2_5d(
  building: Building,
  floor: Floor,
  style: Style2_5d = DEFAULT_STYLE_2_5D,
): Floor2_5d[] {
  const floors: Floor2_5d[] = []

  for (const room of floor.rooms) {
    floors.push({
      id: room.id,
      points: room.polygon.points,
      color: style.floorColor || getWallColor(room),
      opacity: style.floorOpacity,
    })
  }

  return floors
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
