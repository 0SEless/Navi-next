/**
 * RBushSpatialIndex — R-tree spatial index for O(log n) queries.
 *
 * Uses RBush for efficient spatial indexing. Replaces the O(n) brute-force
 * scans in the existing GridSpatialIndex with O(log n) tree searches.
 *
 * @see 02 Engineering/spatial-system.md for architecture.
 */

import RBush from 'rbush'
import type { BBox } from './polygon'

// ── Types ───────────────────────────────────────────────────────────────────

export interface SpatialEntity {
  id: string
  bbox: BBox
}

interface RBushItem {
  minX: number
  minY: number
  maxX: number
  maxY: number
  id: string
}

// ── RBushSpatialIndex ───────────────────────────────────────────────────────

export class RBushSpatialIndex {
  private tree: RBush<RBushItem>
  private entities = new Map<string, SpatialEntity>()
  private items = new Map<string, RBushItem>() // Track items for proper removal

  constructor(maxEntries = 9) {
    this.tree = new RBush<RBushItem>(maxEntries)
  }

  // ── Mutation ──────────────────────────────────────────────────────────────

  insert(entity: SpatialEntity): void {
    this.entities.set(entity.id, entity)
    const item: RBushItem = {
      minX: entity.bbox.minX,
      minY: entity.bbox.minY,
      maxX: entity.bbox.maxX,
      maxY: entity.bbox.maxY,
      id: entity.id,
    }
    this.items.set(entity.id, item)
    this.tree.insert(item)
  }

  remove(id: string): void {
    const entity = this.entities.get(id)
    const item = this.items.get(id)
    if (!entity || !item) return
    this.entities.delete(id)
    this.items.delete(id)
    this.tree.remove(item)
  }

  update(entity: SpatialEntity): void {
    this.remove(entity.id)
    this.insert(entity)
  }

  clear(): void {
    this.tree.clear()
    this.entities.clear()
    this.items.clear()
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Query all entities whose bounding boxes overlap the given bbox.
   * O(log n + k) where k = number of results.
   */
  queryBBox(bbox: BBox): SpatialEntity[] {
    const results = this.tree.search({
      minX: bbox.minX,
      minY: bbox.minY,
      maxX: bbox.maxX,
      maxY: bbox.maxY,
    })
    return results
      .map(r => this.entities.get(r.id))
      .filter(Boolean) as SpatialEntity[]
  }

  /**
   * Query all entities whose bounding boxes contain the given point.
   * O(log n + k) where k = number of results.
   */
  queryPoint(px: number, py: number): SpatialEntity[] {
    return this.queryBBox({ minX: px, minY: py, maxX: px, maxY: py })
  }

  /**
   * Find the nearest entity to the given point.
   * Uses R-tree search to find candidates, then computes exact distance.
   * O(log n + k) where k = number of candidates examined.
   */
  queryNearest(
    px: number,
    py: number,
    maxDistance: number = Infinity,
    maxResults: number = 1,
  ): SpatialEntity[] {
    // Start with a small search area and expand if needed
    const searchBBox = {
      minX: px - maxDistance,
      minY: py - maxDistance,
      maxX: px + maxDistance,
      maxY: py + maxDistance,
    }

    const candidates = this.tree.search(searchBBox)

    // Compute exact distance to center of each candidate's bbox
    const withDistance = candidates
      .map(c => {
        const entity = this.entities.get(c.id)
        if (!entity) return null
        const cx = (c.minX + c.maxX) / 2
        const cy = (c.minY + c.maxY) / 2
        const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2)
        return { entity, dist }
      })
      .filter(Boolean) as { entity: SpatialEntity; dist: number }[]

    // Sort by distance and return top results within maxDistance
    withDistance.sort((a, b) => a.dist - b.dist)
    return withDistance
      .filter(d => d.dist <= maxDistance)
      .slice(0, maxResults)
      .map(d => d.entity)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get size(): number {
    return this.entities.size
  }
}
