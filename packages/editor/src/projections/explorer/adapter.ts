import type { CampusDocument } from '@navi/core'
import type { EntityId, EntitySelector } from '../../context/entity-id'
import { asEntityId } from '../../context/entity-id'

// ── ExplorerNode types ────────────────────────────────────────
// The Explorer renders a tree of these nodes. No business logic.

export type ExplorerNodeType =
  | 'campus'
  | 'building'
  | 'floor'
  | 'room'
  | 'hallway'
  | 'staircase'
  | 'elevator'
  | 'entrance'
  | 'road'
  | 'panorama'
  | 'qr'
  | 'area'

export interface ExplorerNode {
  id: EntityId
  label: string
  type: ExplorerNodeType
  /** Nested children for tree display. */
  children?: ExplorerNode[]
  /** Optional subtitle / secondary info. */
  subtitle?: string
  /** EntitySelector for selection synchronization. */
  entitySelector: EntitySelector
  /** Optional render hints. */
  meta?: {
    icon?: string
    color?: string
    disabled?: boolean
    count?: number
  }
}

// ── Adapter function ──────────────────────────────────────────

/**
 * Project a CampusDocument into a flat array of ExplorerNodes
 * with nested children for tree rendering.
 *
 * Pure function — no state, no side effects.
 */
export function toExplorerNodes(document: CampusDocument): ExplorerNode[] {
  const result: ExplorerNode[] = []

  // ── Buildings → Floors → sub-entities ──────────────────────

  for (const bld of document.buildings) {
    const bldId = asEntityId(bld.id)
    const floorNodes: ExplorerNode[] = []

    for (const fl of bld.floors) {
      const flId = asEntityId(fl.id)
      const children: ExplorerNode[] = []

      // Rooms
      for (const room of fl.rooms) {
        children.push({
          id: asEntityId(room.id),
          label: room.name || room.number || room.id,
          type: 'room',
          entitySelector: { type: 'room', id: asEntityId(room.id), buildingId: bldId, floorId: flId },
          subtitle: room.number,
          meta: { icon: 'room' },
        })
      }

      // Hallways
      for (const hw of fl.hallways) {
        children.push({
          id: asEntityId(hw.id),
          label: hw.name || hw.id,
          type: 'hallway',
          entitySelector: { type: 'hallway', id: asEntityId(hw.id), buildingId: bldId, floorId: flId },
          meta: { icon: 'hallway' },
        })
      }

      // Staircases
      for (const st of fl.staircases) {
        children.push({
          id: asEntityId(st.id),
          label: st.name || st.id,
          type: 'staircase',
          entitySelector: { type: 'staircase', id: asEntityId(st.id), buildingId: bldId, floorId: flId },
          meta: { icon: 'staircase' },
        })
      }

      // Elevators
      for (const el of fl.elevators) {
        children.push({
          id: asEntityId(el.id),
          label: el.name || el.id,
          type: 'elevator',
          entitySelector: { type: 'elevator', id: asEntityId(el.id), buildingId: bldId, floorId: flId },
          meta: { icon: 'elevator' },
        })
      }

      // Entrances
      for (const en of fl.entrances) {
        children.push({
          id: asEntityId(en.id),
          label: en.label || en.id,
          type: 'entrance',
          entitySelector: { type: 'entrance', id: asEntityId(en.id), buildingId: bldId, floorId: flId },
          meta: { icon: 'entrance' },
        })
      }

      floorNodes.push({
        id: flId,
        label: fl.label || `Floor ${fl.level}`,
        type: 'floor',
        entitySelector: { type: 'floor', id: flId, buildingId: bldId },
        subtitle: fl.level === 0 ? 'Ground' : fl.level > 0 ? `Level ${fl.level}` : `Basement ${Math.abs(fl.level)}`,
        children: children.length > 0 ? children : undefined,
        meta: { icon: 'floor', hasPlan: !!fl.planImageId },
      })
    }

    result.push({
      id: bldId,
      label: bld.name || bld.code || bld.id,
      type: 'building',
      entitySelector: { type: 'building', id: bldId },
      subtitle: bld.code,
      children: floorNodes.length > 0 ? floorNodes : undefined,
      meta: { icon: 'building', color: bld.color, count: floorNodes.length },
    })
  }

  // ── Roads (top-level) ───────────────────────────────────────

  for (const road of document.roads) {
    result.push({
      id: asEntityId(road.id),
      label: road.name || road.id,
      type: 'road',
      entitySelector: { type: 'road', id: asEntityId(road.id) },
      subtitle: road.type,
      meta: { icon: 'road' },
    })
  }

  // ── Panoramas (top-level) ───────────────────────────────────

  for (const pano of document.panoramas) {
    result.push({
      id: asEntityId(pano.id),
      label: pano.label || pano.id,
      type: 'panorama',
      entitySelector: { type: 'panorama', id: asEntityId(pano.id) },
      meta: { icon: 'panorama' },
    })
  }

  // ── QR Checkpoints (top-level) ──────────────────────────────

  for (const qr of document.qrCheckpoints) {
    result.push({
      id: asEntityId(qr.id),
      label: qr.label || qr.id,
      type: 'qr',
      entitySelector: { type: 'qr', id: asEntityId(qr.id) },
      subtitle: qr.code,
      meta: { icon: 'qr' },
    })
  }

  // ── Areas (top-level) ────────────────────────────────────────

  if (document.areas) {
    for (const area of document.areas) {
      result.push({
        id: asEntityId(area.id),
        label: area.name || area.id,
        type: 'area',
        entitySelector: { type: 'area', id: asEntityId(area.id) },
        subtitle: area.color ? `Color: ${area.color}` : undefined,
        meta: { icon: 'area', color: area.color },
      })
    }
  }

  return result
}

/**
 * Collect all nodes (including nested children) into a flat list.
 * Useful for search, filtering, and keyboard navigation.
 */
export function flattenNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  const result: ExplorerNode[] = []
  function walk(items: ExplorerNode[]) {
    for (const item of items) {
      result.push(item)
      if (item.children) walk(item.children)
    }
  }
  walk(nodes)
  return result
}

/**
 * Find an ExplorerNode by its EntityId in a tree (breadth-first).
 */
export function findNodeById(nodes: ExplorerNode[], id: EntityId): ExplorerNode | undefined {
  const flat = flattenNodes(nodes)
  return flat.find(n => n.id === id)
}
