import { describe, expect, it } from 'vitest'
import type { NavNode } from '@/types/nav-types'
import { isConnectionPoint } from './geojson'

function node(metadata?: Record<string, unknown>): NavNode {
  return {
    id: 'node-1',
    label: 'Road node',
    type: 'intersection',
    buildingId: '',
    campusId: 'campus-1',
    floor: 0,
    position: { lat: 0, lng: 0 },
    metadata,
  }
}

describe('isConnectionPoint', () => {
  it('treats a shared junction as a connection point', () => {
    expect(isConnectionPoint(node({ connectionNode: true }))).toBe(true)
  })

  it('treats an unconnected road endpoint as a connection point', () => {
    expect(isConnectionPoint(node({ roadEndpoint: true }))).toBe(true)
  })

  it('does not promote ordinary route nodes', () => {
    expect(isConnectionPoint(node({ traceId: 'road-1' }))).toBe(false)
  })
})
