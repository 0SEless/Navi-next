export const TOPOLOGY_THRESHOLDS = {
  stairHallwayMaxDistance: 8,
  elevatorHallwayMaxDistance: 5,
  entranceHallwayMaxDistance: 3,
} as const

export type TopologyThresholds = typeof TOPOLOGY_THRESHOLDS
