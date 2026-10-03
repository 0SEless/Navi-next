/**
 * ASU-Ibajay Demo Campus Generator
 *
 * Creates a validated CampusDocument for the Aklan State University - Ibajay campus.
 * Run: npx tsx scripts/demo-campus.ts
 *
 * Output: campus-output/asu-ibajay.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// ---- Types (mirrors @navi/core) ----

interface LatLng { lat: number; lng: number }
interface LocalCoord { x: number; y: number }
interface WorldPolygon { points: LatLng[] }
interface LocalPolygon { points: LocalCoord[] }
interface WorldPolyline { points: LatLng[] }
interface LocalPolyline { points: LocalCoord[] }

type BuildingCategory = 'academic' | 'library' | 'administrative' | 'dining' | 'other'
type RoomCategory = 'classroom' | 'office' | 'lab' | 'restroom' | 'lobby' | 'stairwell' | 'storage' | 'library' | 'meeting'
type EntranceType = 'main' | 'side' | 'service' | 'emergency'
type StaircaseType = 'open' | 'enclosed' | 'emergency'
type RoadSurface = 'paved' | 'concrete' | 'brick' | 'gravel' | 'grass'
type RoadType = 'arterial' | 'connector' | 'service'

interface Building {
  id: string; name: string; code: string; category: BuildingCategory
  description: string; department?: string
  footprint: WorldPolygon; baseElevation: number; height: number
  floors: Floor[]; color: string; aliases: string[]; metadata: Record<string, unknown>
}

interface Floor {
  id: string; level: number; label: string; elevation: number
  planImageId?: string
  rooms: Room[]; hallways: Hallway[]; staircases: LegacyStaircase[]
  elevators: LegacyElevator[]; entrances: Entrance[]
  textureId?: string; svgOverlayId?: string
}

interface Room {
  id: string; name: string; number: string; category: RoomCategory
  polygon: LocalPolygon; entrancePosition?: LocalCoord
  capacity?: number; metadata: Record<string, unknown>
}

interface Hallway {
  id: string; name: string; polyline: LocalPolyline; width: number; color?: string
}

interface LegacyStaircase {
  id: string; name: string; position: LocalCoord; fromLevel: number; toLevel: number; type: StaircaseType
}

interface LegacyElevator {
  id: string; name: string; position: LocalCoord; fromLevel: number; toLevel: number
}

interface Entrance {
  id: string; label: string; position: LatLng; level: number; type: EntranceType
  hasQR: boolean; hasPanorama: boolean; connectorRoadId?: string
}

interface Road {
  id: string; name: string; polyline: WorldPolyline; width: number
  surface: RoadSurface; type: RoadType; connectorEntranceId?: string; metadata: Record<string, unknown>
}

interface PanoramaHotspot {
  target: { type: 'panorama' | 'room' | 'entrance' | 'qr' | 'url'; targetId: string }
  position: { pitch: number; yaw: number }; label: string
}

interface Panorama {
  id: string; label: string; position: LatLng; heading: number
  imageAssetId: string; buildingId?: string; floor?: number; hotspots: PanoramaHotspot[]
}

interface QRCheckpoint {
  id: string; label: string; position: LatLng; floor: number; buildingId: string; code: string
  metadata: Record<string, unknown>
}

interface CampusDocument {
  schemaVersion: number
  metadata: { name: string; description: string; lastModified: string; editorVersion: string }
  buildings: Building[]; roads: Road[]; panoramas: Panorama[]; qrCheckpoints: QRCheckpoint[]
}

// ---- Building helpers ----

function $poly(pts: LatLng[]): WorldPolygon { return { points: pts } }
function $lpoly(pts: LocalCoord[]): LocalPolygon { return { points: pts } }
function $lpolyline(pts: LocalCoord[]): LocalPolyline { return { points: pts } }
function $wpolyline(pts: LatLng[]): WorldPolyline { return { points: pts } }

// ---- ASU Ibajay approximate coordinates ----
// Campus centroid: ~11.820°N, 122.168°E

const CAMPUS_LAT = 11.820
const CAMPUS_LNG = 122.168

function offset(dlat: number, dlng: number): LatLng {
  return { lat: CAMPUS_LAT + dlat, lng: CAMPUS_LNG + dlng }
}

// ---- Buildings ----

function buildMainBuilding(): Building {
  const sw = offset(-0.0015, -0.002)
  const nw = offset(0.0015, -0.002)
  const ne = offset(0.0015, 0.002)
  const se = offset(-0.0015, 0.002)

  return {
    id: 'bld-main',
    name: 'Main Building',
    code: 'MAIN',
    category: 'administrative',
    description: 'ASU Ibajay Main Building — houses administrative offices and general classrooms',
    department: 'Administration',
    footprint: $poly([sw, nw, ne, se, sw]),
    baseElevation: 10,
    height: 12,
    color: '#8B4513',
    aliases: ['Main', 'Administration Building'],
    metadata: { built: 2005, floors: 2 },
    floors: [
      buildMainGroundFloor(),
      buildMainSecondFloor(),
    ],
  }
}

function buildMainGroundFloor(): Floor {
  return {
    id: 'flr-main-g',
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    rooms: [
      {
        id: 'rm-main-lobby',
        name: 'Main Lobby',
        number: 'Lobby',
        category: 'lobby',
        polygon: $lpoly([
          { x: 2, y: 2 }, { x: 28, y: 2 }, { x: 28, y: 10 }, { x: 2, y: 10 }, { x: 2, y: 2 },
        ]),
        entrancePosition: { x: 15, y: 2 },
        metadata: {},
      },
      {
        id: 'rm-main-101',
        name: 'Registrar Office',
        number: '101',
        category: 'office',
        polygon: $lpoly([
          { x: 2, y: 12 }, { x: 14, y: 12 }, { x: 14, y: 20 }, { x: 2, y: 20 }, { x: 2, y: 12 },
        ]),
        capacity: 6,
        metadata: {},
      },
      {
        id: 'rm-main-102',
        name: 'Accounting Office',
        number: '102',
        category: 'office',
        polygon: $lpoly([
          { x: 16, y: 12 }, { x: 28, y: 12 }, { x: 28, y: 20 }, { x: 16, y: 20 }, { x: 16, y: 12 },
        ]),
        capacity: 6,
        metadata: {},
      },
      {
        id: 'rm-main-103',
        name: 'Room 103',
        number: '103',
        category: 'classroom',
        polygon: $lpoly([
          { x: 2, y: 22 }, { x: 14, y: 22 }, { x: 14, y: 34 }, { x: 2, y: 34 }, { x: 2, y: 22 },
        ]),
        capacity: 40,
        metadata: {},
      },
      {
        id: 'rm-main-104',
        name: 'Room 104',
        number: '104',
        category: 'classroom',
        polygon: $lpoly([
          { x: 16, y: 22 }, { x: 28, y: 22 }, { x: 28, y: 34 }, { x: 16, y: 34 }, { x: 16, y: 22 },
        ]),
        capacity: 40,
        metadata: {},
      },
      {
        id: 'rm-main-g-restroom',
        name: 'Restroom',
        number: 'G-RR',
        category: 'restroom',
        polygon: $lpoly([
          { x: 30, y: 2 }, { x: 34, y: 2 }, { x: 34, y: 8 }, { x: 30, y: 8 }, { x: 30, y: 2 },
        ]),
        metadata: {},
      },
    ],
    hallways: [
      {
        id: 'hlw-main-g-main',
        name: 'Main Hallway',
        polyline: $lpolyline([{ x: 15, y: 0 }, { x: 15, y: 36 }]),
        width: 3,
        color: '#ddd',
      },
      {
        id: 'hlw-main-g-cross',
        name: 'Cross Hallway',
        polyline: $lpolyline([{ x: 0, y: 11 }, { x: 34, y: 11 }]),
        width: 2.5,
        color: '#ddd',
      },
    ],
    staircases: [
      {
        id: 'stair-main-g-a',
        name: 'Staircase A',
        position: { x: 30, y: 30 },
        fromLevel: 0,
        toLevel: 1,
        type: 'enclosed',
      },
    ],
    elevators: [],
    entrances: [
      {
        id: 'ent-main-front',
        label: 'Main Entrance',
        position: offset(0, -0.0025),
        level: 0,
        type: 'main',
        hasQR: true,
        hasPanorama: true,
      },
      {
        id: 'ent-main-side',
        label: 'Side Entrance',
        position: offset(0.0018, 0),
        level: 0,
        type: 'side',
        hasQR: false,
        hasPanorama: false,
      },
    ],
  }
}

function buildMainSecondFloor(): Floor {
  return {
    id: 'flr-main-1',
    level: 1,
    label: 'Second Floor',
    elevation: 4,
    rooms: [
      {
        id: 'rm-main-201',
        name: 'Faculty Room',
        number: '201',
        category: 'office',
        polygon: $lpoly([
          { x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 14 }, { x: 2, y: 14 }, { x: 2, y: 2 },
        ]),
        capacity: 10,
        metadata: {},
      },
      {
        id: 'rm-main-202',
        name: 'Computer Lab',
        number: '202',
        category: 'lab',
        polygon: $lpoly([
          { x: 16, y: 2 }, { x: 28, y: 2 }, { x: 28, y: 14 }, { x: 16, y: 14 }, { x: 16, y: 2 },
        ]),
        capacity: 30,
        metadata: { hasComputers: true },
      },
      {
        id: 'rm-main-203',
        name: 'Room 203',
        number: '203',
        category: 'classroom',
        polygon: $lpoly([
          { x: 2, y: 16 }, { x: 14, y: 16 }, { x: 14, y: 28 }, { x: 2, y: 28 }, { x: 2, y: 16 },
        ]),
        capacity: 35,
        metadata: {},
      },
      {
        id: 'rm-main-204',
        name: 'Room 204',
        number: '204',
        category: 'classroom',
        polygon: $lpoly([
          { x: 16, y: 16 }, { x: 28, y: 16 }, { x: 28, y: 28 }, { x: 16, y: 28 }, { x: 16, y: 16 },
        ]),
        capacity: 35,
        metadata: {},
      },
      {
        id: 'rm-main-205',
        name: 'Conference Room',
        number: '205',
        category: 'meeting',
        polygon: $lpoly([
          { x: 30, y: 16 }, { x: 36, y: 16 }, { x: 36, y: 24 }, { x: 30, y: 24 }, { x: 30, y: 16 },
        ]),
        capacity: 15,
        metadata: {},
      },
    ],
    hallways: [
      {
        id: 'hlw-main-1-main',
        name: 'Main Hallway',
        polyline: $lpolyline([{ x: 15, y: 0 }, { x: 15, y: 30 }]),
        width: 3,
        color: '#ddd',
      },
    ],
    staircases: [
      {
        id: 'stair-main-1-a',
        name: 'Staircase A',
        position: { x: 30, y: 20 },
        fromLevel: 0,
        toLevel: 1,
        type: 'enclosed',
      },
    ],
    elevators: [],
    entrances: [],
  }
}

// ---- Engineering Building ----

function buildEngineeringBuilding(): Building {
  const sw = offset(-0.004, 0.003)
  const nw = offset(-0.001, 0.003)
  const ne = offset(-0.001, 0.006)
  const se = offset(-0.004, 0.006)

  return {
    id: 'bld-eng',
    name: 'Engineering Building',
    code: 'ENG',
    category: 'academic',
    description: 'Engineering and Technology Building',
    department: 'College of Engineering',
    footprint: $poly([sw, nw, ne, se, sw]),
    baseElevation: 10,
    height: 10,
    color: '#2E5984',
    aliases: ['Engineering', 'Tech Building'],
    metadata: { built: 2010, floors: 2 },
    floors: [
      buildEngGroundFloor(),
      buildEngSecondFloor(),
    ],
  }
}

function buildEngGroundFloor(): Floor {
  return {
    id: 'flr-eng-g',
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    rooms: [
      {
        id: 'rm-eng-lobby',
        name: 'Engineering Lobby',
        number: 'Lobby',
        category: 'lobby',
        polygon: $lpoly([
          { x: 2, y: 2 }, { x: 22, y: 2 }, { x: 22, y: 8 }, { x: 2, y: 8 }, { x: 2, y: 2 },
        ]),
        entrancePosition: { x: 12, y: 2 },
        metadata: {},
      },
      {
        id: 'rm-eng-101',
        name: 'Electrical Lab',
        number: '101',
        category: 'lab',
        polygon: $lpoly([
          { x: 2, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 22 }, { x: 2, y: 22 }, { x: 2, y: 10 },
        ]),
        capacity: 25,
        metadata: {},
      },
      {
        id: 'rm-eng-102',
        name: 'Mechanical Lab',
        number: '102',
        category: 'lab',
        polygon: $lpoly([
          { x: 14, y: 10 }, { x: 24, y: 10 }, { x: 24, y: 22 }, { x: 14, y: 22 }, { x: 14, y: 10 },
        ]),
        capacity: 25,
        metadata: {},
      },
      {
        id: 'rm-eng-103',
        name: 'Room 103',
        number: '103',
        category: 'classroom',
        polygon: $lpoly([
          { x: 2, y: 24 }, { x: 12, y: 24 }, { x: 12, y: 34 }, { x: 2, y: 34 }, { x: 2, y: 24 },
        ]),
        capacity: 30,
        metadata: {},
      },
      {
        id: 'rm-eng-104',
        name: 'Room 104',
        number: '104',
        category: 'classroom',
        polygon: $lpoly([
          { x: 14, y: 24 }, { x: 24, y: 24 }, { x: 24, y: 34 }, { x: 14, y: 34 }, { x: 14, y: 24 },
        ]),
        capacity: 30,
        metadata: {},
      },
    ],
    hallways: [
      {
        id: 'hlw-eng-g-main',
        name: 'Main Hallway',
        polyline: $lpolyline([{ x: 13, y: 0 }, { x: 13, y: 36 }]),
        width: 3,
        color: '#ddd',
      },
    ],
    staircases: [
      {
        id: 'stair-eng-g-a',
        name: 'Staircase A',
        position: { x: 22, y: 30 },
        fromLevel: 0,
        toLevel: 1,
        type: 'open',
      },
    ],
    elevators: [],
    entrances: [
      {
        id: 'ent-eng-front',
        label: 'Engineering Entrance',
        position: offset(-0.0025, 0.0045),
        level: 0,
        type: 'main',
        hasQR: true,
        hasPanorama: false,
      },
    ],
  }
}

function buildEngSecondFloor(): Floor {
  return {
    id: 'flr-eng-1',
    level: 1,
    label: 'Second Floor',
    elevation: 4,
    rooms: [
      {
        id: 'rm-eng-201',
        name: 'Engineering Faculty',
        number: '201',
        category: 'office',
        polygon: $lpoly([
          { x: 2, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 12 }, { x: 2, y: 12 }, { x: 2, y: 2 },
        ]),
        capacity: 8,
        metadata: {},
      },
      {
        id: 'rm-eng-202',
        name: 'Drafting Room',
        number: '202',
        category: 'lab',
        polygon: $lpoly([
          { x: 14, y: 2 }, { x: 24, y: 2 }, { x: 24, y: 12 }, { x: 14, y: 12 }, { x: 14, y: 2 },
        ]),
        capacity: 30,
        metadata: {},
      },
      {
        id: 'rm-eng-203',
        name: 'Room 203',
        number: '203',
        category: 'classroom',
        polygon: $lpoly([
          { x: 2, y: 14 }, { x: 12, y: 14 }, { x: 12, y: 24 }, { x: 2, y: 24 }, { x: 2, y: 14 },
        ]),
        capacity: 35,
        metadata: {},
      },
      {
        id: 'rm-eng-204',
        name: 'Room 204',
        number: '204',
        category: 'classroom',
        polygon: $lpoly([
          { x: 14, y: 14 }, { x: 24, y: 14 }, { x: 24, y: 24 }, { x: 14, y: 24 }, { x: 14, y: 14 },
        ]),
        capacity: 35,
        metadata: {},
      },
    ],
    hallways: [
      {
        id: 'hlw-eng-1-main',
        name: 'Main Hallway',
        polyline: $lpolyline([{ x: 13, y: 0 }, { x: 13, y: 26 }]),
        width: 3,
        color: '#ddd',
      },
    ],
    staircases: [
      {
        id: 'stair-eng-1-a',
        name: 'Staircase A',
        position: { x: 22, y: 20 },
        fromLevel: 0,
        toLevel: 1,
        type: 'open',
      },
    ],
    elevators: [],
    entrances: [],
  }
}

// ---- Library ----

function buildLibraryBuilding(): Building {
  const sw = offset(0.002, -0.002)
  const nw = offset(0.004, -0.002)
  const ne = offset(0.004, 0.001)
  const se = offset(0.002, 0.001)

  return {
    id: 'bld-lib',
    name: 'Library',
    code: 'LIB',
    category: 'library',
    description: 'ASU Ibajay Library and Learning Resource Center',
    department: 'Library Services',
    footprint: $poly([sw, nw, ne, se, sw]),
    baseElevation: 10,
    height: 6,
    color: '#4A6741',
    aliases: ['Library', 'Learning Resource Center'],
    metadata: { built: 2008, floors: 1 },
    floors: [
      buildLibraryGroundFloor(),
    ],
  }
}

function buildLibraryGroundFloor(): Floor {
  return {
    id: 'flr-lib-g',
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    rooms: [
      {
        id: 'rm-lib-lobby',
        name: 'Library Lobby',
        number: 'Lobby',
        category: 'lobby',
        polygon: $lpoly([
          { x: 2, y: 2 }, { x: 20, y: 2 }, { x: 20, y: 7 }, { x: 2, y: 7 }, { x: 2, y: 2 },
        ]),
        entrancePosition: { x: 11, y: 2 },
        metadata: {},
      },
      {
        id: 'rm-lib-reading',
        name: 'Reading Area',
        number: 'Reading',
        category: 'library',
        polygon: $lpoly([
          { x: 2, y: 9 }, { x: 20, y: 9 }, { x: 20, y: 22 }, { x: 2, y: 22 }, { x: 2, y: 9 },
        ]),
        capacity: 60,
        metadata: { hasComputers: true },
      },
      {
        id: 'rm-lib-stacks',
        name: 'Book Stacks',
        number: 'Stacks',
        category: 'storage',
        polygon: $lpoly([
          { x: 2, y: 24 }, { x: 20, y: 24 }, { x: 20, y: 34 }, { x: 2, y: 34 }, { x: 2, y: 24 },
        ]),
        metadata: {},
      },
      {
        id: 'rm-lib-office',
        name: 'Librarian Office',
        number: 'Office',
        category: 'office',
        polygon: $lpoly([
          { x: 22, y: 2 }, { x: 28, y: 2 }, { x: 28, y: 10 }, { x: 22, y: 10 }, { x: 22, y: 2 },
        ]),
        capacity: 3,
        metadata: {},
      },
    ],
    hallways: [
      {
        id: 'hlw-lib-g-main',
        name: 'Main Aisle',
        polyline: $lpolyline([{ x: 11, y: 0 }, { x: 11, y: 36 }]),
        width: 4,
        color: '#ddd',
      },
    ],
    staircases: [],
    elevators: [],
    entrances: [
      {
        id: 'ent-lib-front',
        label: 'Library Entrance',
        position: offset(0.003, -0.0022),
        level: 0,
        type: 'main',
        hasQR: true,
        hasPanorama: false,
      },
    ],
  }
}

// ---- Roads ----

function buildRoads(): Road[] {
  return [
    {
      id: 'road-main-gate',
      name: 'Main Gate Road',
      polyline: $wpolyline([
        offset(-0.005, -0.003),
        offset(-0.003, -0.002),
        offset(-0.0015, -0.001),
        { lat: CAMPUS_LAT, lng: CAMPUS_LNG },
      ]),
      width: 8,
      surface: 'concrete',
      type: 'arterial',
      metadata: { lit: true },
    },
    {
      id: 'road-main-eng',
      name: 'Main to Engineering',
      polyline: $wpolyline([
        { lat: CAMPUS_LAT, lng: CAMPUS_LNG },
        offset(-0.002, 0.001),
        offset(-0.0025, 0.004),
      ]),
      width: 4,
      surface: 'concrete',
      type: 'connector',
      metadata: {},
    },
    {
      id: 'road-main-lib',
      name: 'Main to Library',
      polyline: $wpolyline([
        { lat: CAMPUS_LAT, lng: CAMPUS_LNG },
        offset(0.001, 0),
        offset(0.003, -0.001),
      ]),
      width: 3.5,
      surface: 'paved',
      type: 'connector',
      metadata: {},
    },
    {
      id: 'road-eng-lib',
      name: 'Engineering to Library',
      polyline: $wpolyline([
        offset(-0.0025, 0.0045),
        offset(0, 0.002),
        offset(0.003, -0.0005),
      ]),
      width: 3,
      surface: 'paved',
      type: 'connector',
      metadata: {},
    },
  ]
}

// ---- Panorama ----

function buildPanoramas(): Panorama[] {
  return [
    {
      id: 'pan-main-gate',
      label: 'Main Gate',
      position: offset(-0.005, -0.003),
      heading: 180,
      imageAssetId: 'asset-pan-main-gate',
      hotspots: [
        {
          target: { type: 'entrance', targetId: 'ent-main-front' },
          position: { pitch: -5, yaw: 30 },
          label: 'Main Building Entrance',
        },
      ],
    },
    {
      id: 'pan-quad',
      label: 'Campus Quadrangle',
      position: { lat: CAMPUS_LAT, lng: CAMPUS_LNG },
      heading: 45,
      imageAssetId: 'asset-pan-quad',
      hotspots: [
        {
          target: { type: 'entrance', targetId: 'ent-eng-front' },
          position: { pitch: 0, yaw: 120 },
          label: 'Engineering Building',
        },
        {
          target: { type: 'entrance', targetId: 'ent-lib-front' },
          position: { pitch: 0, yaw: 330 },
          label: 'Library',
        },
      ],
    },
  ]
}

// ---- QR Checkpoints ----

function buildQRCheckpoints(): QRCheckpoint[] {
  return [
    {
      id: 'qr-main-gate',
      label: 'Main Gate Checkpoint',
      position: offset(-0.005, -0.003),
      floor: 0,
      buildingId: '',
      code: 'asu-ibajay:main-gate',
      metadata: { type: 'campus_entry' },
    },
    {
      id: 'qr-main-entrance',
      label: 'Main Building Entrance QR',
      position: offset(0, -0.0025),
      floor: 0,
      buildingId: 'bld-main',
      code: 'asu-ibajay:bld-main:entrance',
      metadata: { type: 'building_entry' },
    },
    {
      id: 'qr-main-lobby',
      label: 'Main Lobby QR',
      position: offset(0, -0.0015),
      floor: 0,
      buildingId: 'bld-main',
      code: 'asu-ibajay:bld-main:lobby',
      metadata: { type: 'indoor_checkpoint' },
    },
    {
      id: 'qr-eng-entrance',
      label: 'Engineering Entrance QR',
      position: offset(-0.0025, 0.0045),
      floor: 0,
      buildingId: 'bld-eng',
      code: 'asu-ibajay:bld-eng:entrance',
      metadata: { type: 'building_entry' },
    },
    {
      id: 'qr-lib-entrance',
      label: 'Library Entrance QR',
      position: offset(0.003, -0.0022),
      floor: 0,
      buildingId: 'bld-lib',
      code: 'asu-ibajay:bld-lib:entrance',
      metadata: { type: 'building_entry' },
    },
  ]
}

// ---- Assemble ----

function buildCampus(): CampusDocument {
  // Connect roads to entrances
  const roads = buildRoads()
  roads[1].connectorEntranceId = 'ent-eng-front'
  roads[2].connectorEntranceId = 'ent-lib-front'

  return {
    schemaVersion: 1,
    metadata: {
      name: 'ASU-Ibajay Campus',
      description: 'Aklan State University - Ibajay Campus demo dataset for NAVI navigation platform',
      lastModified: new Date().toISOString(),
      editorVersion: '0.1.0',
    },
    buildings: [
      buildMainBuilding(),
      buildEngineeringBuilding(),
      buildLibraryBuilding(),
    ],
    roads,
    panoramas: buildPanoramas(),
    qrCheckpoints: buildQRCheckpoints(),
  }
}

// ---- Validation ----

function validateBasics(doc: CampusDocument): string[] {
  const errors: string[] = []

  // Check IDs are unique
  const ids = new Set<string>()
  function checkId(id: string, label: string) {
    if (ids.has(id)) errors.push(`Duplicate ID: ${id} (${label})`)
    ids.add(id)
  }

  for (const b of doc.buildings) {
    checkId(b.id, `building ${b.name}`)
    for (const f of b.floors) {
      checkId(f.id, `floor ${f.label} in ${b.name}`)
      for (const r of f.rooms) checkId(r.id, `room ${r.name} in ${b.name}/${f.label}`)
      for (const h of f.hallways) checkId(h.id, `hallway ${h.name} in ${b.name}/${f.label}`)
      for (const s of f.staircases) checkId(s.id, `staircase ${s.name} in ${b.name}/${f.label}`)
      for (const e of f.elevators) checkId(e.id, `elevator ${e.name} in ${b.name}/${f.label}`)
      for (const e of f.entrances) checkId(e.id, `entrance ${e.label} in ${b.name}/${f.label}`)
    }
  }
  for (const r of doc.roads) checkId(r.id, `road ${r.name}`)
  for (const p of doc.panoramas) checkId(p.id, `panorama ${p.label}`)
  for (const q of doc.qrCheckpoints) checkId(q.id, `QR ${q.label}`)

  // Check footprints are closed
  for (const b of doc.buildings) {
    const pts = b.footprint.points
    if (pts.length < 4) errors.push(`Building ${b.name}: footprint too few points (${pts.length})`)
    else if (pts[0].lat !== pts[pts.length - 1].lat || pts[0].lng !== pts[pts.length - 1].lng) {
      errors.push(`Building ${b.name}: footprint not closed`)
    }
  }

  // Check rooms have closed polygons
  for (const b of doc.buildings) {
    for (const f of b.floors) {
      for (const r of f.rooms) {
        const pts = r.polygon.points
        if (pts.length < 4) errors.push(`Room ${r.name}: polygon too few points`)
        else if (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y) {
          errors.push(`Room ${r.name}: polygon not closed`)
        }
      }
    }
  }

  // Check at least one main entrance per building
  for (const b of doc.buildings) {
    const hasMain = b.floors.some(f => f.entrances.some(e => e.type === 'main'))
    if (!hasMain) errors.push(`Building ${b.name}: no main entrance`)
  }

  return errors
}

// ---- Main ----

function main() {
  const campus = buildCampus()
  const json = JSON.stringify(campus, null, 2)

  const outDir = join(__dirname, '..', 'campus-output')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const outPath = join(outDir, 'asu-ibajay.json')
  writeFileSync(outPath, json, 'utf-8')

  // Validate
  const errors = validateBasics(campus)
  if (errors.length > 0) {
    console.log('⚠️  Validation errors:')
    for (const e of errors) console.log(`  ✗ ${e}`)
    process.exit(1)
  }

  // Stats
  const bldCount = campus.buildings.length
  const flrCount = campus.buildings.reduce((s, b) => s + b.floors.length, 0)
  const roomCount = campus.buildings.reduce((s, b) => s + b.floors.reduce((s2, f) => s2 + f.rooms.length, 0), 0)
  const hallwayCount = campus.buildings.reduce((s, b) => s + b.floors.reduce((s2, f) => s2 + f.hallways.length, 0), 0)
  const entranceCount = campus.buildings.reduce((s, b) => s + b.floors.reduce((s2, f) => s2 + f.entrances.length, 0), 0)
  const fileSize = (Buffer.byteLength(json, 'utf-8') / 1024).toFixed(1)

  console.log()
  console.log('✅ ASU-Ibajay Campus Generated')
  console.log('─'.repeat(40))
  console.log(`  Output:     ${outPath}`)
  console.log(`  Size:       ${fileSize} KB`)
  console.log(`  Buildings:  ${bldCount}`)
  console.log(`  Floors:     ${flrCount}`)
  console.log(`  Rooms:      ${roomCount}`)
  console.log(`  Hallways:   ${hallwayCount}`)
  console.log(`  Entrances:  ${entranceCount}`)
  console.log(`  Roads:      ${campus.roads.length}`)
  console.log(`  Panoramas:  ${campus.panoramas.length}`)
  console.log(`  QR Points:  ${campus.qrCheckpoints.length}`)
  console.log('─'.repeat(40))
  console.log('  Validation: ✅ All checks passed')
  console.log('─'.repeat(40))
}

main()
