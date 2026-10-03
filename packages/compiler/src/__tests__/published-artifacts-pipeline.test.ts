import { describe, test, expect } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument } from '@navi/core'

function createSampleDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'test-campus',
      name: 'test-campus',
      description: 'Test campus document',
      lastModified: new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: [
      {
        id: 'bldg-admin',
        name: 'Administration Building',
        code: 'ADM',
        category: 'academic',
        description: 'Main admin building',
        footprint: {
          points: [
            { lat: 11.8180, lng: 122.1700 },
            { lat: 11.8185, lng: 122.1700 },
            { lat: 11.8185, lng: 122.1705 },
            { lat: 11.8180, lng: 122.1705 },
          ],
        },
        baseElevation: 0,
        height: 12,
        color: '#3B82F6',
        aliases: ['Admin', 'HQ'],
        floors: [
          {
            id: 'floor-0',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            height: 3.5,
            planImageId: 'asset-plan-0.png',
            rooms: [
              {
                id: 'room-101',
                name: 'Dean Office',
                number: '101',
                category: 'office',
                polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] },
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [
              { id: 'admin-ent-1', label: 'Main Entrance', position: { lat: 11.8180, lng: 122.1700 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false },
            ],
            connectorStops: [],
            parametricComponents: [],
            metadata: {},
          },
        ],
        verticalConnectors: [],
        metadata: {},
      },
    ],
    roads: [
      {
        id: 'road-1',
        name: 'Main Drive',
        polyline: {
          points: [
            { lat: 11.8175, lng: 122.1700 },
            { lat: 11.8190, lng: 122.1700 },
          ],
        },
        width: 6,
        surface: 'asphalt',
        type: 'primary',
        metadata: {},
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('Published Artifacts Pipeline Integration', () => {
  test('compileV2 produces complete buildingIndex with footprint and floorPlanUrls', () => {
    const compiler = new CampusCompiler()
    const doc = createSampleDocument()
    const result = compiler.compileV2(doc)
    if (!result.success) {
      console.log('compileV2 errors:', JSON.stringify(result.errors, null, 2))
    }

    expect(result.success).toBe(true)
    expect(result.artifacts).toBeDefined()

    const buildingIndex = result.artifacts!.buildingIndex
    expect(buildingIndex).toBeDefined()
    expect(buildingIndex.buildings.length).toBeGreaterThan(0)

    // Ensure __outdoor__ is filtered out
    const outdoorBldg = buildingIndex.buildings.find(b => b.id === '__outdoor__')
    expect(outdoorBldg).toBeUndefined()

    // Ensure real building has footprint and floorPlanUrls
    const adminBldg = buildingIndex.buildings.find(b => b.id === 'bldg-admin')
    expect(adminBldg).toBeDefined()
    expect(adminBldg!.footprint).toBeDefined()
    expect(adminBldg!.footprint!.length).toBe(4)
    expect(adminBldg!.height).toBe(12)
    expect(adminBldg!.color).toBe('#3B82F6')
    expect((adminBldg as any).floorPlanUrls).toEqual({ 0: 'asset-plan-0.png' })
  })

  test('compileV2 searchIndex includes building and room entries', () => {
    const compiler = new CampusCompiler()
    const doc = createSampleDocument()
    const result = compiler.compileV2(doc)

    expect(result.success).toBe(true)
    const searchIndex = result.artifacts!.searchIndex
    expect(searchIndex).toBeDefined()

    const bldgEntry = searchIndex.entries.find(e => e.type === 'building' && e.buildingId === 'bldg-admin')
    expect(bldgEntry).toBeDefined()
    expect(bldgEntry!.label).toBe('Administration Building')

    // P1-T11: rooms are graph-anchored — their search entry nodeId resolves
    // to the room's POI nav node (contract fix: was the document id, which
    // the runtime reference validator rejects).
    const roomEntry = searchIndex.entries.find(e => e.type === 'room' && e.label === 'Dean Office')
    expect(roomEntry).toBeDefined()
    expect(roomEntry!.label).toBe('Dean Office')
    expect(roomEntry!.nodeId).toMatch(/^N-/)
  })
})
