import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { findEntityById } from './property-utils'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Main', code: 'M', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      floors: [{
        id: 'flr-1', level: 0, label: 'Ground', elevation: 0,
        rooms: [{ id: 'rm-1', name: 'R1', number: '101', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, metadata: {} }],
        hallways: [{ id: 'hw-1', name: 'Hall', polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, width: 3 }],
        staircases: [], elevators: [], entrances: [],
        routeNetwork: {
          nodes: [{ id: 'route-node-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 }, { id: 'route-node-2', type: 'waypoint', position: { x: 8, y: 3 }, floor: 0 }],
          edges: [{ id: 'route-edge-1', from: 'route-node-1', to: 'route-node-2', type: 'walk', distance: 6 }],
        },
        metadata: {},
      }],
    }],
    roads: [{ id: 'rd-1', name: 'R', polyline: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] }, width: 5, surface: 'paved', type: 'service', metadata: {} }],
    panoramas: [{ id: 'pan-1', label: 'V', position: { lat: 0, lng: 0 } as any, heading: 0, imageAssetId: 'img', hotspots: [] }],
    qrCheckpoints: [{ id: 'qr-1', label: 'Q', position: { lat: 0, lng: 0 } as any, floor: 0, buildingId: 'bld-1', code: 'c', metadata: {} }],
  }
}

describe('findEntityById', () => {
  it('finds building', () => {
    const r = findEntityById(createDoc(), 'bld-1')
    expect(r?.path).toBe('building')
  })
  it('finds floor', () => {
    const r = findEntityById(createDoc(), 'flr-1')
    expect(r?.path).toBe('floor')
  })
  it('finds room', () => {
    const r = findEntityById(createDoc(), 'rm-1')
    expect(r?.path).toBe('room')
  })
  it('finds hallway', () => {
    const r = findEntityById(createDoc(), 'hw-1')
    expect(r?.path).toBe('hallway')
  })
  it('finds a route node and edge', () => {
    expect(findEntityById(createDoc(), 'route-node-1')?.path).toBe('route-node')
    expect(findEntityById(createDoc(), 'route-edge-1')?.path).toBe('route-edge')
  })
  it('finds road', () => {
    const r = findEntityById(createDoc(), 'rd-1')
    expect(r?.path).toBe('road')
  })
  it('finds panorama', () => {
    const r = findEntityById(createDoc(), 'pan-1')
    expect(r?.path).toBe('panorama')
  })
  it('finds qr', () => {
    const r = findEntityById(createDoc(), 'qr-1')
    expect(r?.path).toBe('qr')
  })
  it('returns null for unknown', () => {
    const r = findEntityById(createDoc(), 'nope')
    expect(r).toBeNull()
  })
})
