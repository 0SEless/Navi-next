/**
 * Stage 4.5 — Entity command handlers
 *
 * The ONLY place CampusDocument is mutated.
 *
 * Rules:
 *   - Handlers are pure mutation functions — no side effects, no rendering.
 *   - Handlers do not know about MapLibre, React, or SelectionManager.
 *   - Each handler handles exactly one command type.
 *   - Validation is minimal — trust the caller (InspectorController).
 */

import type { CampusDocument, Building, Road, Floor, LegacyStaircase, LegacyElevator, Entrance, Panorama, QRCheckpoint } from '@navi/core'
import type { CommandHandler, Command } from './command-bus'

// ── Helpers ────────────────────────────────────────────────────

function findEntity(doc: CampusDocument, type: string, id: string): unknown | null {
  switch (type) {
    case 'building':
      return doc.buildings.find(b => b.id === id) ?? null
    case 'road':
      return doc.roads.find(r => r.id === id) ?? null
    case 'room':
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const room = f.rooms.find(r => r.id === id)
          if (room) return room
        }
      }
      return null
    case 'hallway':
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const hw = f.hallways.find(h => h.id === id)
          if (hw) return hw
        }
      }
      return null
    case 'staircase':
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const e = f.staircases.find(s => s.id === id)
          if (e) return e
        }
      }
      return null
    case 'elevator':
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const e = f.elevators.find(el => el.id === id)
          if (e) return e
        }
      }
      return null
    case 'entrance':
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const e = f.entrances.find(en => en.id === id)
          if (e) return e
        }
      }
      return null
    case 'panorama':
      return doc.panoramas.find(p => p.id === id) ?? null
    case 'qr':
      return doc.qrCheckpoints.find(q => q.id === id) ?? null
    default:
      return null
  }
}

// ── entity.update ──────────────────────────────────────────────

export const entityUpdateHandler: CommandHandler = {
  commandType: 'entity.update',

  execute(ctx, command) {
    const { id, type, changes } = (command as any).payload
    const entity = findEntity(ctx.document, type, id)

    if (!entity) {
      console.warn(`[entity.update] ${type} "${id}" not found`)
      return
    }

    // Apply changes (no deep merge — flat property assignment)
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue
      ;(entity as Record<string, unknown>)[key] = value
    }

    // Bump version
    ctx.document.version++
  },
}

// ── entity.create ──────────────────────────────────────────────

export const entityCreateHandler: CommandHandler = {
  commandType: 'entity.create',

  execute(ctx, command) {
    const { type, data } = (command as any).payload

    switch (type) {
      case 'road': {
        const road = data as Road
        ctx.document.roads.push(road)
        break
      }
      case 'building': {
        const building = data as Building
        ctx.document.buildings.push(building)
        break
      }
      case 'staircase': {
        const building = ctx.document.buildings.find(b => b.id === data.buildingId)
        const floor = building?.floors.find(f => f.id === data.floorId)
        if (floor) floor.staircases.push(data as LegacyStaircase)
        else console.warn(`[entity.create] Floor ${data.floorId} not found for staircase`)
        break
      }
      case 'elevator': {
        const building = ctx.document.buildings.find(b => b.id === data.buildingId)
        const floor = building?.floors.find(f => f.id === data.floorId)
        if (floor) floor.elevators.push(data as LegacyElevator)
        else console.warn(`[entity.create] Floor ${data.floorId} not found for elevator`)
        break
      }
      case 'entrance': {
        const building = ctx.document.buildings.find(b => b.id === data.buildingId)
        const floor = building?.floors.find(f => f.id === data.floorId)
        if (floor) floor.entrances.push(data as Entrance)
        else console.warn(`[entity.create] Floor ${data.floorId} not found for entrance`)
        break
      }
      case 'panorama': {
        ctx.document.panoramas.push(data as Panorama)
        break
      }
      case 'qr': {
        ctx.document.qrCheckpoints.push(data as QRCheckpoint)
        break
      }
      default:
        console.warn(`[entity.create] Cannot create entity type "${type}"`)
        return
    }

    ctx.document.version++
  },
}

// ── entity.delete ──────────────────────────────────────────────

export const entityDeleteHandler: CommandHandler = {
  commandType: 'entity.delete',

  execute(ctx, command) {
    const { id, type } = (command as any).payload

    switch (type) {
      case 'building': {
        const idx = ctx.document.buildings.findIndex(b => b.id === id)
        if (idx !== -1) ctx.document.buildings.splice(idx, 1)
        break
      }
      case 'road': {
        const idx = ctx.document.roads.findIndex(r => r.id === id)
        if (idx !== -1) ctx.document.roads.splice(idx, 1)
        break
      }
      case 'staircase':
      case 'elevator':
      case 'entrance': {
        const arrName = type === 'staircase' ? 'staircases' : type === 'elevator' ? 'elevators' : 'entrances'
        for (const b of ctx.document.buildings) {
          for (const f of b.floors) {
            const idx = (f as any)[arrName].findIndex((e: any) => e.id === id)
            if (idx !== -1) { (f as any)[arrName].splice(idx, 1); break }
          }
        }
        break
      }
      case 'panorama': {
        const idx = ctx.document.panoramas.findIndex(p => p.id === id)
        if (idx !== -1) ctx.document.panoramas.splice(idx, 1)
        break
      }
      case 'qr': {
        const idx = ctx.document.qrCheckpoints.findIndex(q => q.id === id)
        if (idx !== -1) ctx.document.qrCheckpoints.splice(idx, 1)
        break
      }
      default:
        console.warn(`[entity.delete] Cannot delete entity type "${type}"`)
        return
    }

    ctx.document.version++
  },
}
