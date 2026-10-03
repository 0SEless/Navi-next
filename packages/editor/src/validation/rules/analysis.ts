import type { CampusDocument } from '@navi/core'
import { collectFloorDoors } from '@navi/core'
import type { ValidationAffinity } from './types'
import type { GraphAnalysis, GeometryAnalysis, MetadataIndex, SpatialIndex, AnalysisCache } from '../snapshot'

export interface AnalysisPass<T> {
  readonly produces: string
  readonly description: string
  readonly affinity: ValidationAffinity | 'global'
  execute(document: CampusDocument): T
}

export class GraphAnalysisPass implements AnalysisPass<GraphAnalysis> {
  readonly produces = 'graph'
  readonly description = 'Connected components, reachability, orphan nodes'
  readonly affinity = 'global'

  execute(document: CampusDocument): GraphAnalysis {
    return {
      connectedComponentCount: this.computeConnectedComponents(document),
      nodeCount: this.countNodes(document),
      edgeCount: this.countEdges(document),
    }
  }

  private computeConnectedComponents(document: CampusDocument): number {
    // Build entity adjacency graph from document structure
    // Entities are connected if they share a building/floor relationship
    const adj = new Map<string, Set<string>>()
    const addEdge = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set())
      if (!adj.has(b)) adj.set(b, new Set())
      adj.get(a)!.add(b)
      adj.get(b)!.add(a)
    }

    for (const bld of document.buildings) {
      // Building connects to all its floors
      for (const floor of bld.floors) {
        addEdge(bld.id, `${bld.id}-floor-${floor.level}`)

        // Rooms connect to their floor
        for (const room of floor.rooms) {
          addEdge(`${bld.id}-floor-${floor.level}`, room.id)
        }
        // RoomDoors connect rooms to hallways/rooms (P1-T6: single-source
        // door access — extracted Floor.doors first, nested legacy fallback).
        // Doors without connectedToId (unlinked/exterior) contribute no edge.
        for (const door of collectFloorDoors(floor)) {
          if (!door.connectedToId) continue
          addEdge(door.roomId, door.connectedToId)
        }

        // Hallways connect to their floor
        for (const hw of floor.hallways) {
          addEdge(`${bld.id}-floor-${floor.level}`, hw.id)
        }

        // Staircases/elevators connect floors
        for (const st of floor.staircases) {
          addEdge(`${bld.id}-floor-${floor.level}`, `${bld.id}-floor-${st.fromLevel}`)
          addEdge(`${bld.id}-floor-${floor.level}`, `${bld.id}-floor-${st.toLevel}`)
        }
        for (const el of floor.elevators) {
          addEdge(`${bld.id}-floor-${floor.level}`, `${bld.id}-floor-${el.fromLevel}`)
          addEdge(`${bld.id}-floor-${floor.level}`, `${bld.id}-floor-${el.toLevel}`)
        }

        // Entrances connect to building
        for (const ent of floor.entrances) {
          addEdge(`${bld.id}-floor-${floor.level}`, ent.id)
        }
      }

      // VerticalConnectors connect floors
      for (const vc of bld.verticalConnectors) {
        for (const stopId of vc.stopIds) {
          addEdge(bld.id, stopId)
        }
      }
    }

    // Roads are standalone
    for (const road of document.roads) {
      if (!adj.has(road.id)) adj.set(road.id, new Set())
    }

    // Count connected components via BFS
    const allIds = new Set(adj.keys())
    const visited = new Set<string>()
    let components = 0
    for (const id of allIds) {
      if (visited.has(id)) continue
      components++
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor)) queue.push(neighbor)
        }
      }
    }

    return components
  }

  private countNodes(document: CampusDocument): number {
    let count = 0
    for (const bld of document.buildings) {
      count++
      for (const floor of bld.floors) {
        count += floor.rooms.length
        count += floor.hallways.length
        count += floor.staircases.length
        count += floor.elevators.length
        count += floor.entrances.length
      }
    }
    count += document.roads.length
    count += document.panoramas.length
    count += document.qrCheckpoints.length
    return count
  }

  private countEdges(document: CampusDocument): number {
    return document.roads.length + document.buildings.length
  }
}

export class GeometryAnalysisPass implements AnalysisPass<GeometryAnalysis> {
  readonly produces = 'geometry'
  readonly description = 'Polygon validity, overlap detection, winding'
  readonly affinity = 'global'

  execute(document: CampusDocument): GeometryAnalysis {
    const zeroAreaIds: string[] = []
    for (const bld of document.buildings) {
      for (const floor of bld.floors) {
        for (const room of floor.rooms) {
          if (this.isZeroArea(room.polygon.points)) {
            zeroAreaIds.push(room.id)
          }
        }
      }
    }
    return {
      polygonCount: this.countPolygons(document),
      zeroAreaPolygonIds: zeroAreaIds,
    }
  }

  private countPolygons(document: CampusDocument): number {
    let count = 0
    for (const bld of document.buildings) {
      count++
      for (const floor of bld.floors) {
        count += floor.rooms.length
      }
    }
    return count
  }

  private isZeroArea(points: ReadonlyArray<{ x: number; y: number }>): boolean {
    if (points.length < 3) return true
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length
      area += points[i].x * points[j].y
      area -= points[j].x * points[i].y
    }
    return Math.abs(area) < 0.001
  }
}

export class MetadataIndexPass implements AnalysisPass<MetadataIndex> {
  readonly produces = 'metadata'
  readonly description = 'Name index, code index, category index'
  readonly affinity = 'global'

  execute(document: CampusDocument): MetadataIndex {
    const unnamedIds: string[] = []
    let count = 0
    for (const bld of document.buildings) {
      count++
      if (!bld.name) unnamedIds.push(bld.id)
      for (const floor of bld.floors) {
        count++
        if (!floor.label) unnamedIds.push(floor.id)
        for (const room of floor.rooms) {
          count++
          if (!room.name) unnamedIds.push(room.id)
        }
        for (const hw of floor.hallways) {
          count++
          if (!hw.name) unnamedIds.push(hw.id)
        }
        for (const st of floor.staircases) {
          count++
          if (!st.name) unnamedIds.push(st.id)
        }
        for (const el of floor.elevators) {
          count++
          if (!el.name) unnamedIds.push(el.id)
        }
        for (const ent of floor.entrances) {
          count++
          if (!ent.label) unnamedIds.push(ent.id)
        }
      }
    }
    for (const road of document.roads) {
      count++
      if (!road.name) unnamedIds.push(road.id)
    }
    for (const pano of document.panoramas) {
      count++
      if (!pano.label) unnamedIds.push(pano.id)
    }
    for (const qr of document.qrCheckpoints) {
      count++
      if (!qr.label) unnamedIds.push(qr.id)
    }
    return { entityCount: count, unnamedEntityIds: unnamedIds }
  }
}

export class SpatialIndexPass implements AnalysisPass<SpatialIndex> {
  readonly produces = 'spatial'
  readonly description = 'Spatial tree for proximity queries'
  readonly affinity = 'global'

  execute(_document: CampusDocument): SpatialIndex {
    return { isBuilt: false }
  }
}

export function buildAnalysisCache(
  document: CampusDocument,
  passes: ReadonlyArray<AnalysisPass<unknown>>,
): AnalysisCache {
  const cache: Record<string, unknown> = {}
  for (const pass of passes) {
    cache[pass.produces] = pass.execute(document)
  }
  return cache as unknown as AnalysisCache
}
