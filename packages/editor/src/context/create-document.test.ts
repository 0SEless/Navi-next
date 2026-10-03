import { describe, it, expect } from 'vitest'
import { createDocument } from './create-editor-context'

// Verifies the Graph -> CampusDocument conversion (used for backward-compatible
// migration of legacy graphs) preserves every entity type instead of dropping
// roads / qrCheckpoints / version / metadata (see ADR 006 conversion audit).
describe('createDocument (Graph -> CampusDocument) conversion', () => {
  const graph = {
    id: 'g1',
    campusId: 'c1',
    version: '1.0.0',
    updatedAt: '2026-07-15T00:00:00.000Z',
    name: 'Test Campus',
    description: 'A campus description',
    buildings: [
      {
        id: 'b1',
        name: 'Building 1',
        code: 'B1',
        category: 'lab',
        aliases: ['Alpha'],
        metadata: { tag: 'science' },
        footprint: { points: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] },
        floors: [{ id: 'b1-f0', level: 0, rooms: [] }],
      },
    ],
    traces: [
      {
        id: 'road-1',
        name: 'Main Road',
        floor: 0,
        points: [{ lat: 5, lng: 5 }, { lat: 6, lng: 6 }],
        type: 'arterial',
        width: 8,
        metadata: { surface: 'concrete' },
      },
    ],
    nodes: [
      {
        id: 'qr1',
        label: 'QR One',
        type: 'qr_marker',
        position: { lat: 9, lng: 9 },
        floor: 0,
        buildingId: 'b1',
        metadata: { code: 'CODE1' },
      },
      { id: 'n1', label: 'Room', type: 'room', position: { lat: 1, lng: 1 }, floor: 0, buildingId: 'b1' },
    ],
    components: [],
    edges: [],
  }

  it('preserves document metadata from the graph', () => {
    const doc = createDocument(graph)
    expect(doc.version).toBe(1)
    expect(doc.metadata.description).toBe('A campus description')
    expect(doc.metadata.lastModified).toBe('2026-07-15T00:00:00.000Z')
  })

  it('preserves building code / category / aliases / metadata', () => {
    const doc = createDocument(graph)
    const b = doc.buildings[0]
    expect(b.code).toBe('B1')
    expect(b.category).toBe('lab')
    expect(b.aliases).toEqual(['Alpha'])
    expect(b.metadata).toEqual({ tag: 'science' })
  })

  it('converts traces into roads (no longer dropped)', () => {
    const doc = createDocument(graph)
    expect(doc.roads).toHaveLength(1)
    const road = doc.roads[0]
    expect(road.id).toBe('road-1')
    expect(road.name).toBe('Main Road')
    expect(road.width).toBe(8)
    expect(road.surface).toBe('concrete')
    expect(road.type).toBe('arterial')
    expect(road.polyline.points).toHaveLength(2)
  })

  it('converts qr_marker nodes into qrCheckpoints (no longer dropped)', () => {
    const doc = createDocument(graph)
    expect(doc.qrCheckpoints).toHaveLength(1)
    const qr = doc.qrCheckpoints[0]
    expect(qr.id).toBe('qr1')
    expect(qr.label).toBe('QR One')
    // P1-T4 (D9): qr_marker nodes are world — the forward adapter migrates them
    // to building-local (equirect fallback about the footprint centroid (2,3)).
    const METER_PER_DEG = 111320
    expect(qr.position).toEqual({
      x: (9 - 3) * METER_PER_DEG * Math.cos((2 * Math.PI) / 180),
      y: (9 - 2) * METER_PER_DEG,
    })
    expect(qr.position).not.toHaveProperty('lat')
    expect(qr.position).not.toHaveProperty('lng')
    expect(qr.floor).toBe(0)
    expect(qr.buildingId).toBe('b1')
    expect(qr.code).toBe('CODE1')
  })
})
