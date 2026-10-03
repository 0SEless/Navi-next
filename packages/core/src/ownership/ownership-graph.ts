import type { CampusDocument } from '../types/document'
import type { Building, Floor, Room } from '../types/entities'
import { collectFloorDoors } from '../types/floor-doors'

export interface OwnershipIssue {
  type: 'orphan-stop' | 'orphan-connector-ref' | 'orphan-door-ref'
  severity: 'error' | 'warning'
  entityId: string
  message: string
}

function collectStopIds(building: Building): Set<string> {
  const ids = new Set<string>()
  for (const floor of building.floors) {
    for (const stop of floor.connectorStops) {
      ids.add(stop.id)
    }
  }
  return ids
}

function collectConnectorIds(building: Building): Set<string> {
  const ids = new Set<string>()
  for (const conn of building.verticalConnectors) {
    ids.add(conn.id)
  }
  return ids
}

function collectRoomIds(floor: Floor): Set<string> {
  const ids = new Set<string>()
  for (const room of floor.rooms) {
    ids.add(room.id)
  }
  return ids
}

function collectHallwayIds(floor: Floor): Set<string> {
  const ids = new Set<string>()
  for (const hw of floor.hallways) {
    ids.add(hw.id)
  }
  return ids
}

export function validateOwnership(doc: CampusDocument): OwnershipIssue[] {
  const issues: OwnershipIssue[] = []

  for (const building of doc.buildings) {
    const connectorIds = collectConnectorIds(building)
    const stopIds = collectStopIds(building)

    // Every ConnectorStop.connectorId must match a VerticalConnector in the same building
    for (const floor of building.floors) {
      for (const stop of floor.connectorStops) {
        if (!connectorIds.has(stop.connectorId)) {
          issues.push({
            type: 'orphan-connector-ref',
            severity: 'error',
            entityId: stop.id,
            message: `ConnectorStop "${stop.id}" references connector "${stop.connectorId}" which does not exist in building "${building.id}"`,
          })
        }
      }
    }

    // Every VerticalConnector.stopId must match a ConnectorStop in the building
    for (const conn of building.verticalConnectors) {
      for (const sid of conn.stopIds) {
        if (!stopIds.has(sid)) {
          issues.push({
            type: 'orphan-stop',
            severity: 'error',
            entityId: conn.id,
            message: `VerticalConnector "${conn.id}" references stop "${sid}" which does not exist in building "${building.id}"`,
          })
        }
      }
    }

    // RoomDoor connectedToId must reference a room or hallway in the same floor
    // (P1-T6: single-source door access; unlinked doors — no connectedToId/
    // connectedToType — are skipped here, connectivity rules own that case)
    for (const floor of building.floors) {
      const roomIds = collectRoomIds(floor)
      const hallwayIds = collectHallwayIds(floor)
      for (const door of collectFloorDoors(floor)) {
        if (!door.connectedToId || !door.connectedToType) continue
        const validIds = door.connectedToType === 'room' ? roomIds : hallwayIds
        if (!validIds.has(door.connectedToId)) {
          issues.push({
            type: 'orphan-door-ref',
            severity: 'error',
            entityId: door.id,
            message: `RoomDoor "${door.id}" in room "${door.roomId}" references ${door.connectedToType} "${door.connectedToId}" which does not exist on floor "${floor.id}"`,
          })
        }
      }
    }
  }

  return issues
}
