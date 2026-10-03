import { describe, it, expect } from 'vitest'
import { resolvePosition } from '../spatial-resolver'
import { Graph } from '../graph'

describe('Spatial Resolver', () => {
  it('returns nearest node for GPS coordinates', () => {
    const graph = new Graph()
    graph.addNode({
      id: 'N001', label: 'Node A', type: 'room', floor: 0,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 11.81951, lng: 122.09221 },
    })
    graph.addNode({
      id: 'N002', label: 'Node B', type: 'room', floor: 0,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 11.81955, lng: 122.09225 },
    })

    const result = resolvePosition(graph, { lat: 11.8195, lng: 122.0922 })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('N001')
  })

  it('finds a node by QR node ID', () => {
    const graph = new Graph()
    graph.addNode({
      id: 'QR001', label: 'QR Spot', type: 'qr_marker', floor: 1,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 11.8195, lng: 122.0922 },
    })

    const result = resolvePosition(
      graph,
      { lat: 0, lng: 0 },
      { type: 'qr', qrNodeId: 'QR001' }
    )
    expect(result).not.toBeNull()
    expect(result!.id).toBe('QR001')
  })

  it('returns null when no node within maxDistance', () => {
    const graph = new Graph()
    graph.addNode({
      id: 'N001', label: 'Far Node', type: 'room', floor: 0,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 12.0, lng: 122.0 },
    })

    const result = resolvePosition(
      graph,
      { lat: 11.8195, lng: 122.0922 },
      { maxDistance: 10 }
    )
    expect(result).toBeNull()
  })

  it('respects floor filter', () => {
    const graph = new Graph()
    graph.addNode({
      id: 'N001', label: 'Ground', type: 'room', floor: 0,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 11.8195, lng: 122.0922 },
    })
    graph.addNode({
      id: 'N002', label: 'First', type: 'room', floor: 1,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 11.8195, lng: 122.0922 },
    })

    const result = resolvePosition(
      graph,
      { lat: 11.8195, lng: 122.0922 },
      { floor: 1 }
    )
    expect(result).not.toBeNull()
    expect(result!.id).toBe('N002')
  })

  it('prioritizes QR lookup over GPS when type=qr', () => {
    const graph = new Graph()
    graph.addNode({
      id: 'QR001', label: 'QR Marker', type: 'qr_marker', floor: 0,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 12.0, lng: 122.0 },
    })
    graph.addNode({
      id: 'N001', label: 'Close Node', type: 'room', floor: 0,
      buildingId: 'B1', campusId: 'C1',
      position: { lat: 11.8195, lng: 122.0922 },
    })

    const result = resolvePosition(
      graph,
      { lat: 11.8195, lng: 122.0922 },
      { type: 'qr', qrNodeId: 'QR001' }
    )
    expect(result).not.toBeNull()
    expect(result!.id).toBe('QR001')
  })
})
