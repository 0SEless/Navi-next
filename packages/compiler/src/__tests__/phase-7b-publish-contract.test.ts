import { describe, expect, it } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument } from '@navi/core'

function phase7bDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 17,
    connectivitySemanticsVersion: '6.0.0',
    metadata: {
      campusId: 'phase7b-campus',
      name: 'Phase 7B Campus',
      description: 'Publish contract fixture',
      lastModified: '2026-09-06T00:00:00.000Z',
      editorVersion: '1.0.0',
    },
    buildings: [
      {
        id: 'building-7b',
        name: 'Publish Hall',
        code: 'PH',
        category: 'academic',
        description: 'Phase 7B fixture building',
        footprint: {
          points: [
            { lat: 14, lng: 121 },
            { lat: 14.001, lng: 121 },
            { lat: 14.001, lng: 121.001 },
            { lat: 14, lng: 121.001 },
          ],
        },
        baseElevation: 0,
        height: 12,
        color: '#123456',
        aliases: [],
        floors: [
          {
            id: 'floor-7b',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            height: 3.5,
            rooms: [
              {
                id: 'room-7b',
                name: 'Contract Room',
                number: '701',
                category: 'office',
                polygon: {
                  points: [
                    { x: 0, y: 0 },
                    { x: 8, y: 0 },
                    { x: 8, y: 6 },
                    { x: 0, y: 6 },
                  ],
                },
                roomDoors: [
                  {
                    id: 'door-7b',
                    roomId: 'room-7b',
                    connectedToId: 'hallway-7b',
                    connectedToType: 'hallway',
                    doorType: 'standard',
                    position: { x: 4, y: 6 },
                    width: 1.2,
                    metadata: {},
                  },
                ],
                metadata: {},
              },
            ],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [
              {
                id: 'entrance-7b',
                label: 'Main Entrance',
                position: { lat: 14, lng: 121 } as unknown as { x: number; y: number },
                level: 0,
                type: 'main',
                hasQR: false,
                hasPanorama: false,
                connectorRoadId: 'road-7b',
              },
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
        id: 'road-7b',
        name: 'Campus Road',
        polyline: { points: [{ lat: 13.999, lng: 121 }, { lat: 14.002, lng: 121 }] },
        width: 5,
        surface: 'asphalt',
        type: 'primary',
        metadata: {},
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('Phase 7B publish contract', () => {
  it('emits provenance and same-document components and doors', () => {
    const document = phase7bDocument()
    const result = new CampusCompiler().compileV2(document)

    expect(result.success).toBe(true)
    const artifacts = result.artifacts
    expect(artifacts).toBeDefined()
    expect(artifacts?.metadata).toMatchObject({
      campusId: 'phase7b-campus',
      connectivitySemanticsVersion: '6.0.0',
      revision: '17',
      sourceDocumentVersion: '17',
      compilerVersion: '1.0.0',
    })
    expect(Date.parse(artifacts!.metadata!.compiledAt)).not.toBeNaN()
    expect(artifacts!.metadata!.compiledAt).toBe(artifacts!.graph.createdAt)

    const componentIds = (artifacts!.components ?? [])
      .map(component => (component as { id?: unknown }).id)
    expect(componentIds).toContain('room-7b')

    const door = (artifacts!.doors ?? [])
      .find(candidate => (candidate as { id?: unknown }).id === 'door-7b') as {
        roomId?: string
        buildingId?: string
        floor?: number
        width?: number
        connectedToId?: string
        position?: unknown
      } | undefined
    expect(door).toMatchObject({
      roomId: 'room-7b',
      buildingId: 'building-7b',
      floor: 0,
      width: 1.2,
      connectedToId: 'hallway-7b',
    })
    expect(door.position).toEqual(expect.objectContaining({
      lat: expect.any(Number),
      lng: expect.any(Number),
    }))
  })
})
