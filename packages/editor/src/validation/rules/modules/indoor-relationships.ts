import type { CampusDocument, Building, Floor, Wall, Opening, RoomAttributes, RoomAccess, EntranceAccess, VerticalTransition } from '@navi/core'

export interface RelationshipIssue {
  type: string
  entityId: string
  targetId: string
  floorId?: string
  buildingId?: string
}

function wallLength(wall: Wall): number {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function validateIndoorRelationships(document: CampusDocument): RelationshipIssue[] {
  const issues: RelationshipIssue[] = []

  for (const building of document.buildings) {
    for (const floor of building.floors) {
      const wallIds = new Set(floor.walls?.map(w => w.id) ?? [])
      const routeNodeIds = new Set(floor.routeNetwork?.nodes.map(n => n.id) ?? [])
      const entranceIds = new Set(floor.entrances.map(e => e.id))

      // Opening → Wall
      for (const opening of floor.openings ?? []) {
        const wall = floor.walls?.find(w => w.id === opening.wallId)
        if (!wall) {
          issues.push({
            type: 'missing-wall',
            entityId: opening.id,
            targetId: opening.wallId,
            floorId: floor.id,
            buildingId: building.id,
          })
          continue
        }
        const len = wallLength(wall)
        if (opening.offset < 0 || opening.offset > len) {
          issues.push({
            type: 'opening-offset-out-of-bounds',
            entityId: opening.id,
            targetId: opening.wallId,
            floorId: floor.id,
            buildingId: building.id,
          })
        }
      }

      // RoomAttributes → Face (faceId must be non-empty string)
      for (const attr of floor.roomAttributes ?? []) {
        if (!attr.faceId || typeof attr.faceId !== 'string') {
          issues.push({
            type: 'invalid-face-reference',
            entityId: `room-attr:${attr.faceId}`,
            targetId: attr.faceId,
            floorId: floor.id,
            buildingId: building.id,
          })
        }
      }

      // RoomAccess → Opening (door) + RouteNode
      for (const attr of floor.roomAttributes ?? []) {
        for (const access of attr.accessPoints ?? []) {
          if (access.openingId !== undefined) {
            const opening = floor.openings?.find(o => o.id === access.openingId)
            if (!opening) {
              issues.push({
                type: 'missing-opening',
                entityId: `room-access:${attr.faceId}:${access.openingId}`,
                targetId: access.openingId,
                floorId: floor.id,
                buildingId: building.id,
              })
            } else if (opening.type !== 'door') {
              issues.push({
                type: 'opening-not-door',
                entityId: `room-access:${attr.faceId}:${access.openingId}`,
                targetId: access.openingId,
                floorId: floor.id,
                buildingId: building.id,
              })
            }
          }

          const node = floor.routeNetwork?.nodes.find(n => n.id === access.routeNodeId)
          if (!node) {
            issues.push({
              type: 'missing-route-node',
              entityId: `room-access:${attr.faceId}:${access.routeNodeId}`,
              targetId: access.routeNodeId,
              floorId: floor.id,
              buildingId: building.id,
            })
          } else if (node.floor !== floor.level) {
            issues.push({
              type: 'wrong-floor-route-node',
              entityId: `room-access:${attr.faceId}:${access.routeNodeId}`,
              targetId: access.routeNodeId,
              floorId: floor.id,
              buildingId: building.id,
            })
          }
        }
      }

      // EntranceAccess
      for (const ea of floor.entranceAccess ?? []) {
        const entrance = floor.entrances.find(e => e.id === ea.entranceId)
        if (!entrance) {
          issues.push({
            type: 'missing-entrance',
            entityId: `entrance-access:${ea.entranceId}:${ea.indoorRouteNodeId}`,
            targetId: ea.entranceId,
            floorId: floor.id,
            buildingId: building.id,
          })
        }

        const indoorNode = floor.routeNetwork?.nodes.find(n => n.id === ea.indoorRouteNodeId)
        if (!indoorNode) {
          issues.push({
            type: 'missing-indoor-route-node',
            entityId: `entrance-access:${ea.entranceId}:${ea.indoorRouteNodeId}`,
            targetId: ea.indoorRouteNodeId,
            floorId: floor.id,
            buildingId: building.id,
          })
        } else if (indoorNode.floor !== floor.level) {
          issues.push({
            type: 'wrong-floor-indoor-route-node',
            entityId: `entrance-access:${ea.entranceId}:${ea.indoorRouteNodeId}`,
            targetId: ea.indoorRouteNodeId,
            floorId: floor.id,
            buildingId: building.id,
          })
        }
      }
    }

    // VerticalTransition
    for (const vt of building.verticalTransitions ?? []) {
      const inStaircases = building.staircases?.some(s => s.id === vt.featureId) ?? false
      const inElevators = building.elevators?.some(e => e.id === vt.featureId) ?? false
      if (!inStaircases && !inElevators) {
        issues.push({
          type: 'missing-vertical-feature',
          entityId: vt.id,
          targetId: vt.featureId,
          buildingId: building.id,
        })
        continue
      }

      if ((vt.type === 'staircase' && !inStaircases) || (vt.type === 'elevator' && !inElevators)) {
        issues.push({
          type: 'vertical-transition-type-mismatch',
          entityId: vt.id,
          targetId: vt.featureId,
          buildingId: building.id,
        })
      }

      for (const conn of vt.connections) {
        const targetFloor = building.floors.find(f => f.id === conn.floorId)
        if (!targetFloor) {
          issues.push({
            type: 'missing-floor-in-connection',
            entityId: vt.id,
            targetId: conn.floorId,
            buildingId: building.id,
          })
          continue
        }

        const node = targetFloor.routeNetwork?.nodes.find(n => n.id === conn.routeNodeId)
        if (!node) {
          issues.push({
            type: 'missing-route-node-in-connection',
            entityId: vt.id,
            targetId: conn.routeNodeId,
            floorId: conn.floorId,
            buildingId: building.id,
          })
        }
      }
    }
  }

  // Multi-building isolation: EntranceAccess outdoorNodeId references are
  // cross-building by nature (outdoor network), but indoorRouteNodeId must
  // resolve within the same floor/building — already checked above.

  return issues
}
