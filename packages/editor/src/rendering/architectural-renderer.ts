export interface Wall {
  start: { x: number; y: number }
  end: { x: number; y: number }
  thickness?: number
}

export interface Room {
  polygon: { x: number; y: number }[]
  label?: string
  category?: string
}

export interface Door {
  position: { x: number; y: number }
  width: number
  wallIndex?: number
  orientation?: number
}

export interface Window {
  position: { x: number; y: number }
  width: number
  wallIndex?: number
  orientation?: number
}

export interface StairElevatorFeature {
  type: 'stair' | 'elevator'
  position: { x: number; y: number }
  label?: string
  width?: number
  height?: number
}

export interface Entrance {
  position: { x: number; y: number }
  label?: string
  orientation?: number
}

export interface POI {
  position: { x: number; y: number }
  label: string
  icon?: string
}

export interface ArchitecturalStyle {
  wallColor: string
  wallWidth: number
  roomFill: string
  roomStroke: string
  roomLineWidth: number
  doorColor: string
  doorWidth: number
  windowColor: string
  windowWidth: number
  featureFill: string
  featureStroke: string
  featureLineWidth: number
  featureSize: number
  entranceColor: string
  entranceSize: number
  poiColor: string
  poiSize: number
  labelFont: string
  labelSize: number
  labelColor: string
}

export const DEFAULT_ARCHITECTURAL_STYLE: ArchitecturalStyle = {
  wallColor: '#333333',
  wallWidth: 4,
  roomFill: 'rgba(200, 210, 220, 0.25)',
  roomStroke: '#666666',
  roomLineWidth: 1,
  doorColor: '#8B4513',
  doorWidth: 2,
  windowColor: '#87CEEB',
  windowWidth: 2,
  featureFill: '#E0E0E0',
  featureStroke: '#888888',
  featureLineWidth: 1.5,
  featureSize: 16,
  entranceColor: '#FF8C00',
  entranceSize: 8,
  poiColor: '#FF6347',
  poiSize: 6,
  labelFont: '11px sans-serif',
  labelSize: 11,
  labelColor: '#333333',
}

function applyStyle(_ctx: CanvasRenderingContext2D, overrides?: Partial<ArchitecturalStyle>): ArchitecturalStyle {
  return { ...DEFAULT_ARCHITECTURAL_STYLE, ...overrides }
}

export function renderWalls(
  ctx: CanvasRenderingContext2D,
  walls: Wall[],
  style?: Partial<ArchitecturalStyle>,
): void {
  const s = applyStyle(ctx, style)
  ctx.save()
  ctx.strokeStyle = s.wallColor
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const wall of walls) {
    const thickness = wall.thickness ?? s.wallWidth
    ctx.lineWidth = thickness
    ctx.beginPath()
    ctx.moveTo(wall.start.x, wall.start.y)
    ctx.lineTo(wall.end.x, wall.end.y)
    ctx.stroke()
  }
  ctx.restore()
}

export function renderRooms(
  ctx: CanvasRenderingContext2D,
  rooms: Room[],
  style?: Partial<ArchitecturalStyle>,
): void {
  const s = applyStyle(ctx, style)
  ctx.save()
  ctx.fillStyle = s.roomFill
  ctx.strokeStyle = s.roomStroke
  ctx.lineWidth = s.roomLineWidth
  for (const room of rooms) {
    if (room.polygon.length < 3) continue
    ctx.beginPath()
    ctx.moveTo(room.polygon[0].x, room.polygon[0].y)
    for (let i = 1; i < room.polygon.length; i++) {
      ctx.lineTo(room.polygon[i].x, room.polygon[i].y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    if (room.label) {
      const cx = room.polygon.reduce((sum, p) => sum + p.x, 0) / room.polygon.length
      const cy = room.polygon.reduce((sum, p) => sum + p.y, 0) / room.polygon.length
      ctx.fillStyle = s.labelColor
      ctx.font = s.labelFont
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(room.label, cx, cy)
    }
  }
  ctx.restore()
}

export function renderDoors(
  ctx: CanvasRenderingContext2D,
  doors: Door[],
  _walls: Wall[],
  style?: Partial<ArchitecturalStyle>,
): void {
  const s = applyStyle(ctx, style)
  ctx.save()
  ctx.strokeStyle = s.doorColor
  ctx.lineWidth = s.doorWidth
  ctx.lineCap = 'round'
  for (const door of doors) {
    const half = door.width / 2
    const angle = door.orientation ?? 0
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x1 = door.position.x - cos * half
    const y1 = door.position.y - sin * half
    const x2 = door.position.x + cos * half
    const y2 = door.position.y + sin * half
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x1, y1, 3, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

export function renderWindows(
  ctx: CanvasRenderingContext2D,
  windows: Window[],
  _walls: Wall[],
  style?: Partial<ArchitecturalStyle>,
): void {
  const s = applyStyle(ctx, style)
  ctx.save()
  ctx.strokeStyle = s.windowColor
  ctx.lineWidth = s.windowWidth
  ctx.lineCap = 'butt'
  for (const win of windows) {
    const half = win.width / 2
    const angle = win.orientation ?? 0
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x1 = win.position.x - cos * half
    const y1 = win.position.y - sin * half
    const x2 = win.position.x + cos * half
    const y2 = win.position.y + sin * half
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const perpX = -sin * 2
    const perpY = cos * 2
    ctx.beginPath()
    ctx.moveTo(x1 - perpX, y1 - perpY)
    ctx.lineTo(x1 + perpX, y1 + perpY)
    ctx.moveTo(x2 - perpX, y2 - perpY)
    ctx.lineTo(x2 + perpX, y2 + perpY)
    ctx.stroke()
  }
  ctx.restore()
}

export function renderStairsElevators(
  ctx: CanvasRenderingContext2D,
  features: StairElevatorFeature[],
  style?: Partial<ArchitecturalStyle>,
): void {
  const s = applyStyle(ctx, style)
  ctx.save()
  for (const feat of features) {
    const size = feat.type === 'stair' ? s.featureSize : s.featureSize * 0.9
    const w = feat.width ?? size
    const h = feat.height ?? size
    const x = feat.position.x - w / 2
    const y = feat.position.y - h / 2
    ctx.fillStyle = s.featureFill
    ctx.strokeStyle = s.featureStroke
    ctx.lineWidth = s.featureLineWidth
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x, y, w, h)
    if (feat.type === 'stair') {
      const steps = 4
      ctx.strokeStyle = s.featureStroke
      ctx.lineWidth = 1
      for (let i = 1; i < steps; i++) {
        const sy = y + (h / steps) * i
        ctx.beginPath()
        ctx.moveTo(x + 2, sy)
        ctx.lineTo(x + w - 2, sy)
        ctx.stroke()
      }
    } else {
      ctx.strokeStyle = s.featureStroke
      ctx.lineWidth = 1.5
      const cx = feat.position.x
      const cy = feat.position.y
      ctx.beginPath()
      ctx.moveTo(cx - 3, cy - 3)
      ctx.lineTo(cx + 3, cy + 3)
      ctx.moveTo(cx + 3, cy - 3)
      ctx.lineTo(cx - 3, cy + 3)
      ctx.stroke()
    }
    if (feat.label) {
      ctx.fillStyle = s.labelColor
      ctx.font = s.labelFont
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(feat.label, feat.position.x, feat.position.y + h / 2 + 3)
    }
  }
  ctx.restore()
}

export function renderEntrances(
  ctx: CanvasRenderingContext2D,
  entrances: Entrance[],
  style?: Partial<ArchitecturalStyle>,
): void {
  const s = applyStyle(ctx, style)
  ctx.save()
  ctx.fillStyle = s.entranceColor
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 2
  for (const ent of entrances) {
    ctx.beginPath()
    ctx.arc(ent.position.x, ent.position.y, s.entranceSize, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (ent.label) {
      ctx.fillStyle = s.labelColor
      ctx.font = s.labelFont
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(ent.label, ent.position.x, ent.position.y + s.entranceSize + 3)
      ctx.fillStyle = s.entranceColor
    }
  }
  ctx.restore()
}

export function renderPOIs(
  ctx: CanvasRenderingContext2D,
  pois: POI[],
  style?: Partial<ArchitecturalStyle>,
): void {
  const s = applyStyle(ctx, style)
  ctx.save()
  for (const poi of pois) {
    ctx.fillStyle = s.poiColor
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(poi.position.x, poi.position.y - s.poiSize)
    ctx.lineTo(poi.position.x + s.poiSize * 0.7, poi.position.y + s.poiSize * 0.5)
    ctx.lineTo(poi.position.x - s.poiSize * 0.7, poi.position.y + s.poiSize * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    if (poi.label) {
      ctx.fillStyle = s.labelColor
      ctx.font = s.labelFont
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(poi.label, poi.position.x, poi.position.y + s.poiSize + 2)
    }
  }
  ctx.restore()
}
