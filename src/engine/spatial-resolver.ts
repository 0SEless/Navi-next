import type { Graph } from './graph'
import type { LatLng, NavNode } from '@/types/nav-types'
import { haversine } from './a-star'
import { SpatialQueryService } from '@navi/core'

export interface ResolveOptions {
  floor?: number
  maxDistance?: number
  type?: 'gps' | 'qr'
  qrNodeId?: string
}

export function resolvePosition(
  graph: Graph,
  coordinates: LatLng,
  options?: ResolveOptions
): NavNode | null {
  const opts = options ?? {}

  if (opts.type === 'qr' && opts.qrNodeId) {
    return graph.getNode(opts.qrNodeId) ?? null
  }

  const maxDistance = opts.maxDistance ?? 50
  const nodes = opts.floor !== undefined
    ? graph.nodes.filter((n) => n.floor === opts.floor)
    : graph.nodes

  const svc = new SpatialQueryService()
  svc.loadFromNodes(nodes as unknown as Array<{ id: string; position: LatLng; type?: string; floor?: number; buildingId?: string; [key: string]: unknown }>)
  const result = svc.nearestEntity(coordinates, { maxDistance })
  if (!result) return null
  return nodes.find(n => n.id === result.entity.id) ?? null
}
