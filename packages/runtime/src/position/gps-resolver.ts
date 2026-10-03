import type { LatLng } from '@navi/core'
import type { NavNode } from '@navi/core'
import { haversine, SpatialQueryService } from '@navi/core'

export class GpsResolver {
  private nodes: NavNode[]

  constructor(nodes: NavNode[]) {
    this.nodes = nodes
  }

  snap(position: LatLng, floor?: number): { node: NavNode; distance: number } | null {
    const svc = new SpatialQueryService()
    svc.loadFromNodes(this.nodes as unknown as Array<{ id: string; position: LatLng; type?: string; floor?: number; buildingId?: string; [key: string]: unknown }>)
    const options: { floorId?: string } = {}
    if (floor !== undefined) options.floorId = String(floor)
    const result = svc.nearestEntity(position, options)
    if (!result) return null
    const node = this.nodes.find(n => n.id === result.entity.id)
    if (!node) return null
    return { node, distance: result.distance }
  }
}
