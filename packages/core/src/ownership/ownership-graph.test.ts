import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '../types/document'
import { validateOwnership } from './ownership-graph'

function validDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'Test',
      name: 'Test',
      description: '',
      lastModified: new Date().toISOString(),
      editorVersion: '0.1.0',
    },
    buildings: [
      {
        id: 'bld-A',
        name: 'Building A',
        code: 'A',
        category: 'academic' as any,
        description: '',
        footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }, { lat: 0, lng: 1 }, { lat: 0, lng: 0 }] },
        baseElevation: 0,
        height: 10,
        floors: [
          {
            id: 'flr-1',
            level: 0,
            label: 'Floor 1',
            elevation: 0,
            rooms: [
              {
                id: 'rm-101',
                name: 'Room 101',
                number: '101',
                category: 'classroom' as any,
                polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
                roomDoors: [
                  { id: 'd-101-102', roomId: 'rm-101', connectedToId: 'rm-102', connectedToType: 'room', doorType: 'standard', position: { x: 5, y: 2 }, width: 0.9, metadata: {} },
                ],
                metadata: {},
              },
              {
                id: 'rm-102',
                name: 'Room 102',
                number: '102',
                category: 'classroom' as any,
                polygon: { points: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 0 }] },
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [{ id: 'hw-main', name: 'Main', polyline: { points: [{ x: 0, y: 6 }, { x: 10, y: 6 }] }, width: 2 }],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [
              { id: 'cs-stairA-f1', connectorId: 'conn-stairA', position: { x: 2, y: 2 }, anchors: [], accessible: true, metadata: {} },
              { id: 'cs-elev-f1', connectorId: 'conn-elev', position: { x: 8, y: 2 }, anchors: [], accessible: true, metadata: {} },
            ],
            textureId: undefined,
            svgOverlayId: undefined,
            metadata: {},
          },
        ],
        color: '#000',
        aliases: [],
        verticalConnectors: [
          { id: 'conn-stairA', type: 'staircase', name: 'Stair A', stopIds: ['cs-stairA-f1'], accessible: true, metadata: {} },
          { id: 'conn-elev', type: 'elevator', name: 'Elevator', stopIds: ['cs-elev-f1'], accessible: true, metadata: {} },
        ],
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('validateOwnership', () => {
  it('returns no issues for a valid document', () => {
    const issues = validateOwnership(validDoc())
    expect(issues).toHaveLength(0)
  })

  it('detects ConnectorStop with missing VerticalConnector', () => {
    const doc = validDoc()
    doc.buildings[0].floors[0].connectorStops[0].connectorId = 'conn-nonexistent'
    const issues = validateOwnership(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].type).toBe('orphan-connector-ref')
    expect(issues[0].entityId).toBe('cs-stairA-f1')
  })

  it('detects VerticalConnector with missing ConnectorStop', () => {
    const doc = validDoc()
    doc.buildings[0].verticalConnectors[0].stopIds = ['cs-missing']
    const issues = validateOwnership(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].type).toBe('orphan-stop')
    expect(issues[0].entityId).toBe('conn-stairA')
  })

  it('detects RoomDoor referencing missing room', () => {
    const doc = validDoc()
    doc.buildings[0].floors[0].rooms[0].roomDoors[0].connectedToId = 'rm-nonexistent'
    const issues = validateOwnership(doc)
    expect(issues).toHaveLength(1)
    expect(issues[0].type).toBe('orphan-door-ref')
    expect(issues[0].entityId).toBe('d-101-102')
  })

  it('detects multiple issues simultaneously', () => {
    const doc = validDoc()
    doc.buildings[0].floors[0].connectorStops[0].connectorId = 'conn-bad'
    doc.buildings[0].verticalConnectors[0].stopIds = ['cs-bad']
    const issues = validateOwnership(doc)
    expect(issues.length).toBeGreaterThanOrEqual(2)
  })
})
