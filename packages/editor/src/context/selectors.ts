import type { CampusDocument, Building, Floor, Room, Hallway, PointOfInterest } from '@navi/core'

export function findBuilding(document: CampusDocument, id: string): Building | undefined {
  return document.buildings.find((b) => b.id === id)
}

export function findFloorByLevel(document: CampusDocument, buildingId: string, level: number): Floor | undefined {
  const building = findBuilding(document, buildingId)
  return building?.floors.find((f) => f.level === level)
}

export function findFloorById(document: CampusDocument, buildingId: string, floorId: string): Floor | undefined {
  const building = findBuilding(document, buildingId)
  return building?.floors.find((f) => f.id === floorId)
}

export function getBuildingFloors(document: CampusDocument, buildingId: string): Floor[] {
  const building = findBuilding(document, buildingId)
  return building?.floors ?? []
}

export function getBuildingFloorCount(document: CampusDocument, buildingId: string): number {
  return getBuildingFloors(document, buildingId).length
}

export interface FloorEntities {
  rooms: Room[]
  hallways: Hallway[]
  staircases: import('@navi/core').LegacyStaircase[]
  elevators: import('@navi/core').LegacyElevator[]
  entrances: import('@navi/core').Entrance[]
  pois: PointOfInterest[]
}

export function getFloorEntities(document: CampusDocument, buildingId: string, level: number): FloorEntities {
  const floor = findFloorByLevel(document, buildingId, level)
  if (!floor) {
    return { rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], pois: [] }
  }
  return {
    rooms: floor.rooms,
    hallways: floor.hallways,
    staircases: floor.staircases,
    elevators: floor.elevators,
    entrances: floor.entrances,
    pois: floor.pois ?? [],
  }
}

export function findRoom(document: CampusDocument, buildingId: string, floorLevel: number, roomId: string): Room | undefined {
  const floor = findFloorByLevel(document, buildingId, floorLevel)
  return floor?.rooms.find((r) => r.id === roomId)
}

export interface EntityResult {
  type: 'building' | 'floor' | 'room' | 'hallway' | 'staircase' | 'elevator' | 'entrance' | 'road' | 'panorama' | 'qr' | 'poi'
  path: string[]
  data: unknown
}

export function findEntity(document: CampusDocument, entityId: string): EntityResult | undefined {
  for (const building of document.buildings) {
    if (building.id === entityId) {
      return { type: 'building', path: [`buildings.${building.id}`], data: building }
    }
    for (const floor of building.floors) {
      if (floor.id === entityId) {
        return { type: 'floor', path: [`buildings.${building.id}`, `floors.${floor.id}`], data: floor }
      }
      for (const room of floor.rooms) {
        if (room.id === entityId) {
          return { type: 'room', path: [`buildings.${building.id}`, `floors.${floor.id}`, `rooms.${room.id}`], data: room }
        }
      }
      for (const hallway of floor.hallways) {
        if (hallway.id === entityId) {
          return { type: 'hallway', path: [`buildings.${building.id}`, `floors.${floor.id}`, `hallways.${hallway.id}`], data: hallway }
        }
      }
      for (const staircase of floor.staircases) {
        if (staircase.id === entityId) {
          return { type: 'staircase', path: [`buildings.${building.id}`, `floors.${floor.id}`, `staircases.${staircase.id}`], data: staircase }
        }
      }
      for (const elevator of floor.elevators) {
        if (elevator.id === entityId) {
          return { type: 'elevator', path: [`buildings.${building.id}`, `floors.${floor.id}`, `elevators.${elevator.id}`], data: elevator }
        }
      }
      for (const entrance of floor.entrances) {
        if (entrance.id === entityId) {
          return { type: 'entrance', path: [`buildings.${building.id}`, `floors.${floor.id}`, `entrances.${entrance.id}`], data: entrance }
        }
      }
      for (const poi of floor.pois ?? []) {
        if (poi.id === entityId) {
          return { type: 'poi', path: [`buildings.${building.id}`, `floors.${floor.id}`, `pois.${poi.id}`], data: poi }
        }
      }
    }
  }
  for (const poi of document.pois ?? []) {
    if (poi.id === entityId) {
      return { type: 'poi', path: [`pois.${poi.id}`], data: poi }
    }
  }
  for (const road of document.roads) {
    if (road.id === entityId) {
      return { type: 'road', path: [`roads.${road.id}`], data: road }
    }
  }
  for (const panorama of document.panoramas) {
    if (panorama.id === entityId) {
      return { type: 'panorama', path: [`panoramas.${panorama.id}`], data: panorama }
    }
  }
  for (const qr of document.qrCheckpoints) {
    if (qr.id === entityId) {
      return { type: 'qr', path: [`qrCheckpoints.${qr.id}`], data: qr }
    }
  }
  return undefined
}

export function findComponent(document: CampusDocument, componentId: string): { type: string; data: Room | Hallway | import('@navi/core').LegacyStaircase | import('@navi/core').LegacyElevator } | undefined {
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        if (room.id === componentId) return { type: 'room', data: room }
      }
      for (const hallway of floor.hallways) {
        if (hallway.id === componentId) return { type: 'hallway', data: hallway }
      }
      for (const staircase of floor.staircases) {
        if (staircase.id === componentId) return { type: 'staircase', data: staircase }
      }
      for (const elevator of floor.elevators) {
        if (elevator.id === componentId) return { type: 'elevator', data: elevator }
      }
    }
  }
  return undefined
}
