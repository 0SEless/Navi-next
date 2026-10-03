import type { CampusDocument, RoomAttributes, VerticalTransition } from '@navi/core'

/**
 * Centralized, fail-closed cleanup for persisted routing relationships.
 *
 * These functions only remove references to identities that are being
 * deleted. They never select a replacement by geometry or proximity.
 */

export function cleanupRoadRoutingReferences(document: CampusDocument, roadId: string): void {
  const existingRoadIds = new Set(document.roads.map(road => road.id))

  if (document.roadJunctions) {
    document.roadJunctions = document.roadJunctions
      .map(junction => {
        if (!junction.roadIds.includes(roadId)) return junction
        return {
          ...junction,
          roadIds: [...new Set(junction.roadIds.filter(
            candidateId => candidateId !== roadId && existingRoadIds.has(candidateId),
          ))],
        }
      })
      .filter(junction => junction.roadIds.length >= 2)
  }

  if (document.separatedCrossings) {
    document.separatedCrossings = document.separatedCrossings.filter(
      crossing => !crossing.roadIds.includes(roadId),
    )
  }

  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const entrance of floor.entrances) {
        if (entrance.connectorRoadId === roadId) delete entrance.connectorRoadId
      }
      if (floor.entranceAccess) {
        floor.entranceAccess = floor.entranceAccess.filter(
          access => access.outdoorRouteId !== roadId && access.outdoorNodeId !== roadId,
        )
      }
    }
  }
}

export interface RouteNodeRelationshipSnapshot {
  roomAttributes: RoomAttributes[] | undefined
  entranceAccess: NonNullable<CampusDocument['buildings'][number]['floors'][number]['entranceAccess']> | undefined
  verticalTransitions: VerticalTransition[] | undefined
}

export function cleanupRouteNodeRoutingReferences(
  document: CampusDocument,
  buildingId: string,
  floorId: string,
  routeNodeId: string,
): RouteNodeRelationshipSnapshot | undefined {
  const building = document.buildings.find(candidate => candidate.id === buildingId)
  const floor = building?.floors.find(candidate => candidate.id === floorId)
  if (!building || !floor) return undefined

  const snapshot: RouteNodeRelationshipSnapshot = {
    roomAttributes: floor.roomAttributes === undefined
      ? undefined
      : JSON.parse(JSON.stringify(floor.roomAttributes)) as RoomAttributes[],
    entranceAccess: floor.entranceAccess === undefined
      ? undefined
      : JSON.parse(JSON.stringify(floor.entranceAccess)) as NonNullable<typeof floor.entranceAccess>,
    verticalTransitions: building.verticalTransitions === undefined
      ? undefined
      : JSON.parse(JSON.stringify(building.verticalTransitions)) as VerticalTransition[],
  }

  if (floor.roomAttributes) {
    for (const room of floor.roomAttributes) {
      if (room.accessPoints) {
        room.accessPoints = room.accessPoints.filter(access => access.routeNodeId !== routeNodeId)
      }
    }
  }
  if (floor.entranceAccess) {
    floor.entranceAccess = floor.entranceAccess.filter(access => access.indoorRouteNodeId !== routeNodeId)
  }
  if (building.verticalTransitions) {
    // A VerticalTransition is an ordered authored chain. Removing a named stop
    // and retaining the rest would reinterpret the new neighbors as adjacent,
    // so invalidate the whole relationship while preserving the feature.
    building.verticalTransitions = building.verticalTransitions.filter(transition =>
      !transition.connections.some(connection =>
        connection.floorId === floorId && connection.routeNodeId === routeNodeId,
      ),
    )
  }

  return snapshot
}

/**
 * Read-only enumeration of every Door-owned connector edge id (anchor → target
 * stub) across the whole document. Connector edges are Door-owned and must
 * never be treated as ordinary route edges by junction authoring commands.
 */
export function collectDoorConnectorEdgeIds(document: CampusDocument): Set<string> {
  const connectorEdgeIds = new Set<string>()
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const door of floor.doors ?? []) {
        const connectorEdgeId = door.routeConnection?.connectorEdgeId
        if (connectorEdgeId) connectorEdgeIds.add(connectorEdgeId)
      }
    }
  }
  return connectorEdgeIds
}

/**
 * Read-only mirror of cleanupRouteNodeRoutingReferences' reference kinds: a
 * route node is referenced while any access relationship still names it.
 * Keep this next to the cleanup so new reference kinds are extended in one
 * place instead of being forgotten by callers.
 */
export function isRouteNodeReferencedByAccessRelationships(
  document: CampusDocument,
  buildingId: string,
  floorId: string,
  routeNodeId: string,
): boolean {
  const building = document.buildings.find(candidate => candidate.id === buildingId)
  const floor = building?.floors.find(candidate => candidate.id === floorId)
  if (!building || !floor) return false
  if (floor.entranceAccess?.some(access => access.indoorRouteNodeId === routeNodeId)) return true
  if (floor.roomAttributes?.some(attributes =>
    attributes.accessPoints?.some(point => point.routeNodeId === routeNodeId)) ?? false) return true
  return building.verticalTransitions?.some(transition =>
    transition.connections.some(connection =>
      connection.floorId === floorId && connection.routeNodeId === routeNodeId)) ?? false
}

export function restoreRouteNodeRoutingReferences(
  document: CampusDocument,
  buildingId: string,
  floorId: string,
  snapshot: RouteNodeRelationshipSnapshot,
): void {
  const building = document.buildings.find(candidate => candidate.id === buildingId)
  const floor = building?.floors.find(candidate => candidate.id === floorId)
  if (!building || !floor) return

  floor.roomAttributes = snapshot.roomAttributes === undefined
    ? undefined
    : JSON.parse(JSON.stringify(snapshot.roomAttributes)) as RoomAttributes[]
  floor.entranceAccess = snapshot.entranceAccess === undefined
    ? undefined
    : JSON.parse(JSON.stringify(snapshot.entranceAccess)) as NonNullable<typeof floor.entranceAccess>
  building.verticalTransitions = snapshot.verticalTransitions === undefined
    ? undefined
    : JSON.parse(JSON.stringify(snapshot.verticalTransitions)) as VerticalTransition[]
}

export function cleanupEntranceRoutingReferences(document: CampusDocument, entranceId: string): void {
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      if (floor.entranceAccess) {
        floor.entranceAccess = floor.entranceAccess.filter(access => access.entranceId !== entranceId)
      }
    }
  }
  for (const road of document.roads) {
    if (road.connectorEntranceId === entranceId) delete road.connectorEntranceId
  }
}

export function cleanupFeatureRoutingReferences(
  building: CampusDocument['buildings'][number],
  featureId: string,
): VerticalTransition[] {
  const removed = (building.verticalTransitions ?? []).filter(
    transition => transition.featureId === featureId,
  )
  if (building.verticalTransitions) {
    building.verticalTransitions = building.verticalTransitions.filter(
      transition => transition.featureId !== featureId,
    )
  }
  return JSON.parse(JSON.stringify(removed)) as VerticalTransition[]
}

export function cleanupBuildingRoutingReferences(
  document: CampusDocument,
  building: CampusDocument['buildings'][number],
): void {
  const entranceIds = new Set(
    building.floors.flatMap(floor => floor.entrances.map(entrance => entrance.id)),
  )
  for (const road of document.roads) {
    if (road.connectorEntranceId && entranceIds.has(road.connectorEntranceId)) {
      delete road.connectorEntranceId
    }
  }
}

export function cleanupFloorRoutingReferences(
  document: CampusDocument,
  building: CampusDocument['buildings'][number],
  floor: CampusDocument['buildings'][number]['floors'][number],
): void {
  for (const entrance of floor.entrances ?? []) {
    cleanupEntranceRoutingReferences(document, entrance.id)
  }

  const removedStopIds = new Set((floor.connectorStops ?? []).map(stop => stop.id))
  building.verticalConnectors = (building.verticalConnectors ?? [])
    .map(connector => ({
      ...connector,
      stopIds: connector.stopIds.filter(stopId => !removedStopIds.has(stopId)),
    }))
    .filter(connector => connector.stopIds.length > 0)

  if (building.verticalTransitions) {
    // The transition is an authored ordered chain. Removing one floor and
    // retaining its former neighbors would invent a new segment, so remove
    // only transitions that used this floor and preserve unrelated ones.
    building.verticalTransitions = building.verticalTransitions.filter(transition =>
      !transition.connections.some(connection => connection.floorId === floor.id),
    )
  }

  const removeLevel = <T extends { levels: Record<number, unknown>; fromLevel: number; toLevel: number }>(
    features: T[] | undefined,
  ): T[] | undefined => {
    if (!features) return undefined
    const surviving: T[] = []
    for (const feature of features) {
      if (!Object.prototype.hasOwnProperty.call(feature.levels, floor.level)) {
        surviving.push(feature)
        continue
      }
      delete feature.levels[floor.level]
      const levels = Object.keys(feature.levels).map(Number).sort((a, b) => a - b)
      if (levels.length === 0) continue
      feature.fromLevel = levels[0]!
      feature.toLevel = levels[levels.length - 1]!
      surviving.push(feature)
    }
    return surviving
  }

  building.staircases = removeLevel(building.staircases)
  building.elevators = removeLevel(building.elevators)
}
