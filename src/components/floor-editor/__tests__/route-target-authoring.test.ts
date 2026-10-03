import { describe, expect, it } from 'vitest'
import { resolveRouteTargetHit } from '../route-target-authoring'

const click = { lat: 11.8195, lng: 122.0922 }

describe('resolveRouteTargetHit', () => {
  it('prefers a route node over an edge under the pointer', () => {
    const hit = resolveRouteTargetHit([
      { layer: { id: 'floor-route-edges-line' }, properties: { id: 'edge-1' } },
      { layer: { id: 'floor-route-nodes-circle' }, properties: { id: 'node-1' }, geometry: { type: 'Point', coordinates: [122.0922, 11.8195] } },
    ], click)
    expect(hit).toEqual({ kind: 'node', id: 'node-1', position: click })
  })

  it('resolves a segment to the clicked position', () => {
    const hit = resolveRouteTargetHit([
      { layer: { id: 'floor-route-edges-line' }, properties: { id: 'edge-1' } },
    ], click)
    expect(hit).toEqual({ kind: 'edge', id: 'edge-1', position: click })
  })

  it('resolves an entrance marker to its exact geometry', () => {
    const hit = resolveRouteTargetHit([
      { layer: { id: 'floor-items-entrance' }, properties: { id: 'entrance-1' }, geometry: { type: 'Point', coordinates: [122.0930, 11.8200] } },
    ], click)
    expect(hit).toEqual({ kind: 'entrance', id: 'entrance-1', position: { lat: 11.82, lng: 122.093 } })
  })

  it('returns null when nothing is hit', () => {
    expect(resolveRouteTargetHit([], click)).toBeNull()
  })
})
