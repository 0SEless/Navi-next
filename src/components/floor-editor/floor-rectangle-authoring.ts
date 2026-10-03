import type { LocalCoord } from '@navi/core'

export type FloorRectangleTool = 'door' | 'stairs' | 'elevator'

export interface FloorRectangle {
  min: LocalCoord
  max: LocalCoord
  center: LocalCoord
  width: number
  depth: number
  points: LocalCoord[]
}

interface FloorRectangleEditTarget {
  id: string
  featureId?: string
  type: 'door' | 'stair' | 'elevator'
  floor: number
}

interface ScreenPoint {
  x: number
  y: number
}

interface RectangleCommandContext {
  buildingId: string
  floorId: string
  floorLevel: number
  entityId: string
}

export function buildFloorRectangleCommand(tool: FloorRectangleTool, rectangle: FloorRectangle, context: RectangleCommandContext) {
  if (tool === 'door') {
    return {
      command: {
        id: 'door.create', label: 'Create Door',
        payload: {
          buildingId: context.buildingId, floorId: context.floorId,
          door: {
            id: context.entityId, name: 'Door', doorType: 'standard', position: rectangle.center,
            width: rectangle.width, depth: rectangle.depth, rotation: 0,
            geometry: { type: 'rectangle', min: rectangle.min, max: rectangle.max, rotation: 0 }, metadata: {},
          },
        },
      },
      selectedId: context.entityId,
    }
  }

  const featureType = tool === 'stairs' ? 'staircase' : 'elevator'
  return {
    command: {
      id: 'feature.create', label: featureType === 'staircase' ? 'Create Staircase' : 'Create Elevator',
      payload: {
        buildingId: context.buildingId, floor: context.floorLevel, id: context.entityId, featureType,
        position: rectangle.center, rotation: 0, polygon: { points: rectangle.points },
        fromLevel: context.floorLevel, toLevel: context.floorLevel + 1,
      },
    },
    selectedId: `${context.entityId}-${context.floorLevel}`,
  }
}

export function buildFloorRectangleEditCommand(target: FloorRectangleEditTarget, points: LocalCoord[]) {
  if (points.length !== 4) throw new Error('A rectangle edit requires exactly four corners')

  const center = points.reduce(
    (value, point) => ({ x: value.x + point.x / points.length, y: value.y + point.y / points.length }),
    { x: 0, y: 0 },
  )
  const width = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
  const depth = Math.hypot(points[2].x - points[1].x, points[2].y - points[1].y)
  const rotation = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x)

  if (target.type === 'door') {
    return {
      id: 'door.update',
      label: 'Edit door',
      payload: {
        doorId: target.id,
        patch: {
          position: center,
          width,
          depth,
          rotation,
          geometry: {
            type: 'rectangle' as const,
            min: { x: center.x - width / 2, y: center.y - depth / 2 },
            max: { x: center.x + width / 2, y: center.y + depth / 2 },
            rotation,
          },
        },
      },
    }
  }

  return {
    id: 'feature.update',
    label: `Edit ${target.type}`,
    payload: {
      featureId: target.featureId ?? target.id,
      level: target.floor,
      patch: { position: center, rotation, polygon: { points } },
    },
  }
}

export function rectangleRotationHandleScreenPoint(center: ScreenPoint, edge: ScreenPoint, distance = 24): ScreenPoint {
  const dx = edge.x - center.x
  const dy = edge.y - center.y
  const magnitude = Math.hypot(dx, dy)
  const unit = magnitude > 0 ? { x: dx / magnitude, y: dy / magnitude } : { x: 0, y: -1 }
  return { x: edge.x + unit.x * distance, y: edge.y + unit.y * distance }
}
