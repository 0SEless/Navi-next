/**
 * P1.1 Gate 2 — Publish Artifact contains floor plans.
 *
 * Verifies that buildBuildingIndex emits floorPlanUrls for a building that
 * carries floor plan images, so the published building-index.json (consumed
 * by PublicMap runtime) includes them.
 */

import { describe, it, expect } from 'vitest'
import { buildBuildingIndex } from '../artifacts/artifact-generator'
import type { CampusDocument } from '@navi/core'

function docWithFloorPlans(useFloorPlanUrls: boolean): CampusDocument {
  const building: any = {
    id: 'b1', name: 'Science Hall', code: 'SH', category: 'academic', description: '',
    footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }] },
    baseElevation: 0, height: 12,
    floors: [{
      id: 'f0', level: 0, label: 'GF', elevation: 0,
      rooms: [], hallways: [], staircases: [], elevators: [], entrances: [],
    planImageId: 'data:image/png;base64,AAA',
      planAlignment: { offset: { x: 2, y: -1 }, scale: 1.25, rotation: 18, opacity: 0.6 },
      metadata: {},
    }],
    color: '#1C6BEB', aliases: [], metadata: {},
  }
  if (useFloorPlanUrls) {
    building.floorPlanUrls = { 0: 'data:image/png;base64,AAA' }
  }
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Campus', name: 'Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

// Compatibility coverage for the additive BuildingIndex floor-plan URL and
// visual metadata contract. Legacy URLs remain readable; alignment is
// presentation-only and never enters the navigation graph.
describe('Gate 2 | Publish artifact includes floor plans', () => {
  const graph: any = { nodes: [], edges: [] }
  it('emits floorPlanUrls when the building carries floorPlanUrls', () => {
    const { buildings: entries } = buildBuildingIndex(docWithFloorPlans(true), graph)
    expect((entries[0] as any).floorPlanUrls).toBeDefined()
    expect((entries[0] as any).floorPlanUrls?.[0]).toContain('data:image/png')
  })

  it('emits floorPlanUrls derived from floor.planImageId when floorPlanUrls is absent', () => {
    const { buildings: entries } = buildBuildingIndex(docWithFloorPlans(false), graph)
    expect((entries[0] as any).floorPlanUrls).toBeDefined()
    expect((entries[0] as any).floorPlanUrls?.[0]).toContain('data:image/png')
  })

  it('publishes optional visual alignment metadata without changing graph topology', () => {
    const graphWithTopology: any = {
      nodes: [{ id: 'n1', buildingId: 'b1', floor: 0, position: { lat: 14, lng: 121 } }],
      edges: [{ id: 'e1', from: 'n1', to: 'n1', weight: 0 }],
    }
    const before = JSON.stringify(graphWithTopology)
    const { buildings: entries } = buildBuildingIndex(docWithFloorPlans(false), graphWithTopology)

    expect((entries[0] as any).floorPlanVisuals?.[0]).toEqual({
      imageUrl: 'data:image/png;base64,AAA',
      alignment: { offset: { x: 2, y: -1 }, scale: 1.25, rotation: 18, opacity: 0.6 },
    })
    expect(JSON.stringify(graphWithTopology)).toBe(before)
  })
})
