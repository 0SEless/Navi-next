import type { LatLng } from '@navi/core'
import type { NavNode } from '@navi/core'
import { GpsResolver } from './gps-resolver'

export interface CurrentPosition {
  latlng: LatLng
  nodeId: string
  floor: number
  buildingId: string
  heading: number
  accuracy: number
}

export class PositionEngine {
  private resolver: GpsResolver
  private currentPosition: CurrentPosition | null = null

  constructor(nodes: NavNode[]) {
    this.resolver = new GpsResolver(nodes)
  }

  updateGps(latlng: LatLng, heading: number = 0, accuracy: number = 10): void {
    const snapped = this.resolver.snap(latlng)
    if (!snapped) return
    this.currentPosition = {
      latlng,
      nodeId: snapped.node.id,
      floor: snapped.node.floor,
      buildingId: snapped.node.buildingId,
      heading,
      accuracy,
    }
  }

  getCurrentPosition(): CurrentPosition | null {
    return this.currentPosition
  }

  getCurrentFloor(): number | null {
    return this.currentPosition?.floor ?? null
  }
}
