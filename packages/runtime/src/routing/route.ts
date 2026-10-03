import type { LatLng } from '@navi/core'

export type InstructionType = 'walk' | 'stairs' | 'elevator' | 'turn_left' | 'turn_right' | 'arrive'

export interface RouteStep {
  nodeId: string
  /** Selected incoming edge; absent only for the first path node. */
  edgeId?: string
  label: string
  position: LatLng
  floor: number
  buildingId: string
}

export interface Instruction {
  type: InstructionType
  text: string
  distance: number
  fromNode: string
  toNode: string
}

export interface TravelTime {
  seconds: number
  minutes: number
  formatted: string
}

export interface RouteDestination {
  entityType: 'poi'
  entityId: string
  resolvedApproach?: {
    kind: 'node' | 'edge'
    networkId: string
    position: LatLng
    distanceMeters: number
    floor: number
    buildingId: string
  }
}

export interface Route {
  path: RouteStep[]
  instructions: Instruction[]
  totalDistance: number
  /** Generalized traversal cost used for route selection; never a distance. */
  generalizedCost?: number
  totalDuration: number
  fromLabel: string
  toLabel: string
  travelTime: TravelTime
  /** Stable destination identity; never the request-local target node ID. */
  destination?: RouteDestination
}
