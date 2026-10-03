import type { LatLng, LocalCoord } from '../types'
import type { BBox } from './polygon'

// ── Grid-based spatial index ──
// Partitions 2D space into uniform cells. Each cell stores entity IDs.
// Fast for campus-scale (thousands of entities, not millions).

export interface SpatialEntity {
  id: string
  bbox: BBox
}

export class GridSpatialIndex {
  private cellSize: number  // meters (or coordinate units)
  private grid = new Map<string, Set<string>>()
  private entities = new Map<string, SpatialEntity>()

  constructor(cellSize = 50) {
    this.cellSize = cellSize
  }

  private cellKey(cx: number, cy: number): string {
    return `${Math.floor(cx / this.cellSize)},${Math.floor(cy / this.cellSize)}`
  }

  private cellKeysForBBox(bbox: BBox): string[] {
    const minCX = Math.floor(bbox.minX / this.cellSize)
    const maxCX = Math.floor(bbox.maxX / this.cellSize)
    const minCY = Math.floor(bbox.minY / this.cellSize)
    const maxCY = Math.floor(bbox.maxY / this.cellSize)
    const keys: string[] = []
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        keys.push(`${cx},${cy}`)
      }
    }
    return keys
  }

  insert(entity: SpatialEntity): void {
    this.entities.set(entity.id, entity)
    const keys = this.cellKeysForBBox(entity.bbox)
    for (const key of keys) {
      let cell = this.grid.get(key)
      if (!cell) {
        cell = new Set()
        this.grid.set(key, cell)
      }
      cell.add(entity.id)
    }
  }

  remove(id: string): void {
    const entity = this.entities.get(id)
    if (!entity) return
    this.entities.delete(id)
    const keys = this.cellKeysForBBox(entity.bbox)
    for (const key of keys) {
      this.grid.get(key)?.delete(id)
    }
  }

  update(entity: SpatialEntity): void {
    this.remove(entity.id)
    this.insert(entity)
  }

  queryPoint(px: number, py: number): SpatialEntity[] {
    const key = this.cellKey(px, py)
    const cell = this.grid.get(key)
    if (!cell) return []
    const results: SpatialEntity[] = []
    for (const id of cell) {
      const e = this.entities.get(id)
      if (e && px >= e.bbox.minX && px <= e.bbox.maxX && py >= e.bbox.minY && py <= e.bbox.maxY) {
        results.push(e)
      }
    }
    return results
  }

  queryBBox(bbox: BBox): SpatialEntity[] {
    const keys = this.cellKeysForBBox(bbox)
    const seen = new Set<string>()
    const results: SpatialEntity[] = []
    for (const key of keys) {
      const cell = this.grid.get(key)
      if (!cell) continue
      for (const id of cell) {
        if (seen.has(id)) continue
        seen.add(id)
        const e = this.entities.get(id)
        if (e && bboxesOverlap(e.bbox, bbox)) {
          results.push(e)
        }
      }
    }
    return results
  }

  queryNearest(px: number, py: number, maxResults = 5): SpatialEntity[] {
    const all: { entity: SpatialEntity; dist: number }[] = []
    for (const entity of this.entities.values()) {
      const cx = (entity.bbox.minX + entity.bbox.maxX) / 2
      const cy = (entity.bbox.minY + entity.bbox.maxY) / 2
      const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2)
      all.push({ entity, dist })
    }
    all.sort((a, b) => a.dist - b.dist)
    return all.slice(0, maxResults).map(e => e.entity)
  }

  get size(): number {
    return this.entities.size
  }

  clear(): void {
    this.grid.clear()
    this.entities.clear()
  }
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}
