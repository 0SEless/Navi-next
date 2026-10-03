import type { RoadRouting } from '@navi/core'
import type { LatLng, NavEdge, NavNode, PathResult } from '@/types/nav-types'

export const TERRAIN_VALIDATION_PROFILE = 'STANDARD_TERRAIN_PROFILE_V1' as const

export interface TerrainValidationExpected {
  routeFound: boolean
  selectedEdgeIds: string[]
  physicalDistance?: number
  generalizedCost?: number
}

export interface TerrainValidationCase {
  id: string
  label: string
  origin: string
  destination: string
  expected: TerrainValidationExpected
}

export interface TerrainValidationFixture {
  id: string
  name: string
  description: string
  nodes: NavNode[]
  edges: NavEdge[]
  cases: TerrainValidationCase[]
  defaultCaseId: string
}

export interface TerrainValidationActual {
  routeFound: boolean
  selectedEdgeIds: string[]
  physicalDistance?: number
  generalizedCost?: number
}

const CAMPUS_ID = 'terrain-validation-fixtures'
const ORIGIN_LAT = 11.8
const ORIGIN_LNG = 122.17
const METERS_PER_DEGREE_LAT = 111_320
const METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180)

function position(offsetMeters: number, northMeters = 0): LatLng {
  return {
    lat: ORIGIN_LAT + northMeters / METERS_PER_DEGREE_LAT,
    lng: ORIGIN_LNG + offsetMeters / METERS_PER_DEGREE_LNG,
  }
}

function node(
  id: string,
  label: string,
  type: NavNode['type'],
  offsetMeters: number,
  buildingId = '',
  floor = 0,
): NavNode {
  return {
    id,
    label,
    name: label,
    type,
    position: position(offsetMeters),
    floor,
    buildingId,
    campusId: CAMPUS_ID,
  }
}

function legacyEdge(
  id: string,
  from: string,
  to: string,
  distance: number,
  type: NavEdge['type'] = 'walk',
  weight = distance,
): NavEdge {
  return { id, from, to, distance, weight, type }
}

function roadEdge(
  id: string,
  from: string,
  to: string,
  distance: number,
  authored: RoadRouting,
  type: NavEdge['type'] = 'walk',
): NavEdge {
  return {
    id,
    from,
    to,
    distance,
    weight: distance,
    type,
    routing: {
      sourceRoadId: `road-${id}`,
      authoredOrientation: 'forward',
      authored,
    },
  }
}

const levelVsSteep: TerrainValidationFixture = {
  id: 'level-vs-steep',
  name: 'Level vs steep',
  description: 'Equal 100 m alternatives: MEDIUM terrain cost prefers level over steep.',
  nodes: [
    node('level-steep-origin', 'Level/steep origin', 'outdoor', 0),
    node('level-steep-destination', 'Level/steep destination', 'outdoor', 100),
  ],
  edges: [
    roadEdge('level-route', 'level-steep-origin', 'level-steep-destination', 100, { slope: 'level' }),
    roadEdge('steep-route', 'level-steep-origin', 'level-steep-destination', 100, { slope: 'steep' }),
  ],
  cases: [{
    id: 'level-wins',
    label: 'Level wins over equal steep route',
    origin: 'level-steep-origin',
    destination: 'level-steep-destination',
    expected: {
      routeFound: true,
      selectedEdgeIds: ['level-route'],
      physicalDistance: 100,
      generalizedCost: 100,
    },
  }],
  defaultCaseId: 'level-wins',
}

const stairsVsNormal: TerrainValidationFixture = {
  id: 'stairs-vs-normal',
  name: 'Stairs vs normal',
  description: 'A 100 m outdoor stairs Road (cost 120) beats a 130 m normal edge.',
  nodes: [
    node('stairs-normal-origin', 'Stairs/normal origin', 'outdoor', 0),
    node('stairs-normal-destination', 'Stairs/normal destination', 'outdoor', 100),
  ],
  edges: [
    roadEdge('stairs-route', 'stairs-normal-origin', 'stairs-normal-destination', 100, { feature: 'stairs', slope: 'level' }),
    legacyEdge('normal-route', 'stairs-normal-origin', 'stairs-normal-destination', 130),
  ],
  cases: [{
    id: 'stairs-wins',
    label: 'Shorter stairs route wins',
    origin: 'stairs-normal-origin',
    destination: 'stairs-normal-destination',
    expected: {
      routeFound: true,
      selectedEdgeIds: ['stairs-route'],
      physicalDistance: 100,
      generalizedCost: 120,
    },
  }],
  defaultCaseId: 'stairs-wins',
}

const forwardOnly: TerrainValidationFixture = {
  id: 'forward-only',
  name: 'Forward-only',
  description: 'A forward Road is traversable only from authored start to authored end.',
  nodes: [
    node('forward-origin', 'Forward origin', 'outdoor', 0),
    node('forward-destination', 'Forward destination', 'outdoor', 10),
  ],
  edges: [
    roadEdge('forward-road', 'forward-origin', 'forward-destination', 10, { direction: 'forward' }),
  ],
  cases: [
    {
      id: 'forward-allowed',
      label: 'Authored direction allowed',
      origin: 'forward-origin',
      destination: 'forward-destination',
      expected: { routeFound: true, selectedEdgeIds: ['forward-road'], physicalDistance: 10, generalizedCost: 10 },
    },
    {
      id: 'reverse-blocked',
      label: 'Reverse direction blocked',
      origin: 'forward-destination',
      destination: 'forward-origin',
      expected: { routeFound: false, selectedEdgeIds: [] },
    },
  ],
  defaultCaseId: 'forward-allowed',
}

const reverseOnly: TerrainValidationFixture = {
  id: 'reverse-only',
  name: 'Reverse-only',
  description: 'A reverse Road is blocked in authored order and allowed in reverse traversal.',
  nodes: [
    node('reverse-origin', 'Reverse origin', 'outdoor', 0),
    node('reverse-destination', 'Reverse destination', 'outdoor', 10),
  ],
  edges: [
    roadEdge('reverse-road', 'reverse-origin', 'reverse-destination', 10, { direction: 'reverse' }),
  ],
  cases: [
    {
      id: 'forward-blocked',
      label: 'Authored direction blocked',
      origin: 'reverse-origin',
      destination: 'reverse-destination',
      expected: { routeFound: false, selectedEdgeIds: [] },
    },
    {
      id: 'reverse-allowed',
      label: 'Reverse traversal allowed',
      origin: 'reverse-destination',
      destination: 'reverse-origin',
      expected: { routeFound: true, selectedEdgeIds: ['reverse-road'], physicalDistance: 10, generalizedCost: 10 },
    },
  ],
  defaultCaseId: 'forward-blocked',
}

const walkableFalse: TerrainValidationFixture = {
  id: 'walkable-false',
  name: 'Walkable false',
  description: 'A blocked direct shortcut is ignored in favor of an eligible parallel edge.',
  nodes: [
    node('walkable-origin', 'Walkability origin', 'outdoor', 0),
    node('walkable-destination', 'Walkability destination', 'outdoor', 70),
  ],
  edges: [
    roadEdge('blocked-shortcut', 'walkable-origin', 'walkable-destination', 50, { walkable: false }),
    legacyEdge('eligible-alternative', 'walkable-origin', 'walkable-destination', 70),
  ],
  cases: [{
    id: 'eligible-alternative-wins',
    label: 'Eligible alternative wins over blocked shortcut',
    origin: 'walkable-origin',
    destination: 'walkable-destination',
    expected: {
      routeFound: true,
      selectedEdgeIds: ['eligible-alternative'],
      physicalDistance: 70,
      generalizedCost: 70,
    },
  }],
  defaultCaseId: 'eligible-alternative-wins',
}

const outdoorEntranceIndoor: TerrainValidationFixture = {
  id: 'outdoor-entrance-indoor',
  name: 'Outdoor → entrance → indoor',
  description: 'A terrain Road crosses an entrance boundary into an indoor hallway and room.',
  nodes: [
    node('unified-outdoor-origin', 'Outdoor origin', 'outdoor', 0),
    node('unified-road-access', 'Road access', 'outdoor', 20),
    node('unified-entrance', 'Building entrance', 'entrance', 23, 'fixture-building'),
    node('unified-hallway', 'Indoor hallway', 'hallway', 33, 'fixture-building'),
    node('unified-room', 'Destination room', 'room', 38, 'fixture-building'),
  ],
  edges: [
    roadEdge('unified-terrain-road', 'unified-outdoor-origin', 'unified-road-access', 20, { feature: 'normal', slope: 'gentle' }),
    legacyEdge('unified-entrance-access', 'unified-road-access', 'unified-entrance', 3, 'transition'),
    legacyEdge('unified-indoor-hallway', 'unified-entrance', 'unified-hallway', 10, 'walk', 12),
    legacyEdge('unified-room-access', 'unified-hallway', 'unified-room', 5),
  ],
  cases: [{
    id: 'crosses-all-boundaries',
    label: 'Outdoor to entrance to indoor room',
    origin: 'unified-outdoor-origin',
    destination: 'unified-room',
    expected: {
      routeFound: true,
      selectedEdgeIds: [
        'unified-terrain-road',
        'unified-entrance-access',
        'unified-indoor-hallway',
        'unified-room-access',
      ],
      physicalDistance: 38,
      generalizedCost: 40.8,
    },
  }],
  defaultCaseId: 'crosses-all-boundaries',
}

export const terrainValidationFixtures: TerrainValidationFixture[] = [
  levelVsSteep,
  stairsVsNormal,
  forwardOnly,
  reverseOnly,
  walkableFalse,
  outdoorEntranceIndoor,
]

export function getTerrainValidationFixture(id: string): TerrainValidationFixture | undefined {
  return terrainValidationFixtures.find((fixture) => fixture.id === id)
}

export function getTerrainValidationCase(
  fixture: TerrainValidationFixture,
  caseId = fixture.defaultCaseId,
): TerrainValidationCase | undefined {
  return fixture.cases.find((fixtureCase) => fixtureCase.id === caseId)
}

export function summarizeTerrainRoute(result: PathResult | null): TerrainValidationActual {
  if (!result) return { routeFound: false, selectedEdgeIds: [] }

  return {
    routeFound: true,
    selectedEdgeIds: result.steps
      .slice(1)
      .map((step) => step.edgeId)
      .filter((edgeId): edgeId is string => Boolean(edgeId)),
    physicalDistance: result.cost,
    generalizedCost: result.generalizedCost,
  }
}

export function matchesTerrainExpectation(
  expected: TerrainValidationExpected,
  actual: TerrainValidationActual,
): boolean {
  if (expected.routeFound !== actual.routeFound) return false
  if (!expected.routeFound) return actual.selectedEdgeIds.length === 0
  if (JSON.stringify(expected.selectedEdgeIds) !== JSON.stringify(actual.selectedEdgeIds)) return false
  if (expected.physicalDistance !== undefined
    && (actual.physicalDistance === undefined || Math.abs(actual.physicalDistance - expected.physicalDistance) > 1e-8)) {
    return false
  }
  if (expected.generalizedCost !== undefined
    && (actual.generalizedCost === undefined || Math.abs(actual.generalizedCost - expected.generalizedCost) > 1e-8)) {
    return false
  }
  return true
}
