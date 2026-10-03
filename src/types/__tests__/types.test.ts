import { describe, it, expect } from 'vitest'
import type { TracePath, FloorPlan } from '../nav-types'
import type { StudioTool, EditorMode, LayerType } from '../studio-types'

describe('TracePath', () => {
  it('accepts valid trace path data', () => {
    const trace: TracePath = {
      id: 'T001',
      buildingId: 'BLD01',
      floor: 1,
      points: [{ lat: 11.8195, lng: 122.0922 }, { lat: 11.8196, lng: 122.0923 }],
      type: 'arterial',
    }
    expect(trace.id).toBe('T001')
    expect(trace.points.length).toBe(2)
  })
})

describe('FloorPlan', () => {
  it('accepts valid floor plan data', () => {
    const fp: FloorPlan = {
      buildingId: 'BLD01',
      floor: 1,
      imageUrl: 'https://example.com/floor1.png',
      uploadedAt: '2026-06-21T00:00:00Z',
    }
    expect(fp.imageUrl).toContain('example.com')
  })
})

describe('StudioTool', () => {
  it('accepts all tool values', () => {
    const tools: StudioTool[] = ['select', 'move', 'room', 'asset', 'qr', 'pano', 'route']
    expect(tools).toHaveLength(7)
  })
})

describe('EditorMode', () => {
  it('accepts all mode values', () => {
    const modes: EditorMode[] = ['campus', 'building', 'floor']
    expect(modes).toHaveLength(3)
  })
})

describe('LayerType', () => {
  it('accepts all layer values', () => {
    const layers: LayerType[] = ['osm', 'satellite', 'floor_plan', 'buildings', 'rooms', 'hallways', 'assets', 'nodes', 'edges', 'labels']
    expect(layers).toHaveLength(10)
  })
})
