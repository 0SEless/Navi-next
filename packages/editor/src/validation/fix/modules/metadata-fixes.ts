import type { CampusDocument } from '@navi/core'
import type { ValidationIssue } from '../../snapshot'
import type { FixProvider, FixContext } from '../types'
import type { Command } from '../../../commands/types'

function entityExists(document: CampusDocument, id: string): boolean {
  for (const bld of document.buildings) {
    if (bld.id === id) return true
    for (const flr of bld.floors) {
      for (const grp of [flr.rooms, flr.hallways, flr.staircases, flr.elevators, flr.entrances]) {
        for (const ent of grp) {
          if ((ent as any).id === id) return true
        }
      }
    }
  }
  for (const ent of document.roads) if ((ent as any).id === id) return true
  for (const ent of document.panoramas) if ((ent as any).id === id) return true
  for (const ent of document.qrCheckpoints) if ((ent as any).id === id) return true
  return false
}

export const assignUntitledFix: FixProvider = {
  fixId: 'metadata.assign-name',
  label: 'Assign "Untitled"',
  description: 'Assigns "Untitled" as the name for entities missing a name or label',

  canFix(issue: ValidationIssue, context: FixContext): boolean {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return false
    return entityExists(context.document, entityId)
  },

  createCommand(issue: ValidationIssue, context: FixContext): Command | null {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return null
    if (!entityExists(context.document, entityId)) return null
    return {
      id: 'entity.update',
      label: 'Assign "Untitled"',
      payload: { entityId, changes: { name: 'Untitled' } },
    }
  },
}

function floorExists(document: CampusDocument, id: string): boolean {
  for (const bld of document.buildings) {
    for (const flr of bld.floors) {
      if (flr.id === id) return true
    }
  }
  return false
}

function findFloorLevel(document: CampusDocument, id: string): number {
  for (const bld of document.buildings) {
    const idx = bld.floors.findIndex(f => f.id === id)
    if (idx !== -1) return idx
  }
  return -1
}

export const assignFloorLevelFix: FixProvider = {
  fixId: 'metadata.assign-floor-level',
  label: 'Assign Floor Level',
  description: 'Assigns the floor index within its building as the level number',

  canFix(issue: ValidationIssue, context: FixContext): boolean {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return false
    return floorExists(context.document, entityId)
  },

  createCommand(issue: ValidationIssue, context: FixContext): Command | null {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return null
    const level = findFloorLevel(context.document, entityId)
    if (level < 0) return null
    return {
      id: 'entity.update',
      label: 'Assign Floor Level',
      payload: { entityId, changes: { level } },
    }
  },
}

function hasBrokenRoadRef(document: CampusDocument, id: string): boolean {
  const roadIds = new Set(document.roads.map(r => r.id))
  for (const bld of document.buildings) {
    for (const flr of bld.floors) {
      for (const ent of flr.entrances) {
        if (ent.id === id && ent.connectorRoadId && !roadIds.has(ent.connectorRoadId)) return true
      }
    }
  }
  return false
}

export const clearRoadReferenceFix: FixProvider = {
  fixId: 'metadata.clear-road-reference',
  label: 'Clear Road Reference',
  description: 'Clears the connectorRoadId on entrances referencing non-existent roads',

  canFix(issue: ValidationIssue, context: FixContext): boolean {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return false
    return hasBrokenRoadRef(context.document, entityId)
  },

  createCommand(issue: ValidationIssue, context: FixContext): Command | null {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return null
    if (!hasBrokenRoadRef(context.document, entityId)) return null
    return {
      id: 'entity.update',
      label: 'Clear Road Reference',
      payload: { entityId, changes: { connectorRoadId: undefined } },
    }
  },
}

function hasBrokenEntranceRef(document: CampusDocument, id: string): boolean {
  const entranceIds = new Set<string>()
  for (const bld of document.buildings) {
    for (const flr of bld.floors) {
      for (const ent of flr.entrances) entranceIds.add(ent.id)
    }
  }
  for (const road of document.roads) {
    if (road.id === id && road.connectorEntranceId && !entranceIds.has(road.connectorEntranceId)) return true
  }
  return false
}

export const clearEntranceReferenceFix: FixProvider = {
  fixId: 'metadata.clear-entrance-reference',
  label: 'Clear Entrance Reference',
  description: 'Clears the connectorEntranceId on roads referencing non-existent entrances',

  canFix(issue: ValidationIssue, context: FixContext): boolean {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return false
    return hasBrokenEntranceRef(context.document, entityId)
  },

  createCommand(issue: ValidationIssue, context: FixContext): Command | null {
    const entityId = issue.targets[0]?.entityId
    if (!entityId) return null
    if (!hasBrokenEntranceRef(context.document, entityId)) return null
    return {
      id: 'entity.update',
      label: 'Clear Entrance Reference',
      payload: { entityId, changes: { connectorEntranceId: undefined } },
    }
  },
}
