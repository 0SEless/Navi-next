import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { deriveNavigationSegment } from '../NavigationContext'
import { NavigationProvider, useNavigationContext } from '../NavigationContext'
import type { NavRoute } from '../../../types/route-types'

/** Minimal NavRoute fixture for testing segment derivation. */
function makeRoute(steps: NavRoute['steps']): NavRoute {
  return {
    path: steps.map(s => s.nodeId),
    steps,
    instructions: [],
    totalDistance: 100,
    totalDuration: 0,
    fromLabel: 'Start',
    toLabel: 'End',
    arrival: { nodeId: steps[steps.length - 1]?.nodeId ?? '', label: '', position: { lat: 0, lng: 0 }, remainingDistance: 0 },
    nodeFloors: [...new Set(steps.map(s => s.floor))].sort((a, b) => b - a),
  }
}

describe('deriveNavigationSegment (real data)', () => {
  const route = makeRoute([
    { nodeId: 'A', label: 'Outside', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', type: 'walk' },
    { nodeId: 'B', label: 'Entrance', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', type: 'entrance' },
    { nodeId: 'C', label: 'Hallway', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', type: 'walk' },
    { nodeId: 'D', label: 'Stairs', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', type: 'stairs' },
    { nodeId: 'E', label: 'Floor 1', position: { lat: 0, lng: 0 }, floor: 1, buildingId: 'b1', type: 'walk' },
  ])

  it('returns outdoor when no route', () => {
    expect(deriveNavigationSegment({ route: null, currentNodeId: null })).toBe('outdoor')
  })

  it('returns outdoor when no currentNode', () => {
    expect(deriveNavigationSegment({ route, currentNodeId: null })).toBe('outdoor')
  })

  it('returns outdoor when currentNode not in route', () => {
    expect(deriveNavigationSegment({ route, currentNodeId: 'X' })).toBe('outdoor')
  })

  it('returns entrance at entrance node', () => {
    expect(deriveNavigationSegment({ route, currentNodeId: 'B' })).toBe('entrance')
  })

  it('returns indoor at walk node', () => {
    expect(deriveNavigationSegment({ route, currentNodeId: 'C' })).toBe('indoor')
  })

  it('returns floor-transition at stair node', () => {
    expect(deriveNavigationSegment({ route, currentNodeId: 'D' })).toBe('floor-transition')
  })

  it('returns floor-transition when floor mismatches activeFloor', () => {
    expect(deriveNavigationSegment({ route, currentNodeId: 'E', floor: 0, activeFloor: 1 })).toBe('floor-transition')
  })

  it('returns indoor when floor matches activeFloor', () => {
    expect(deriveNavigationSegment({ route, currentNodeId: 'E', floor: 1, activeFloor: 1 })).toBe('indoor')
  })
})

function HeadingContextProbe() {
  const context = useNavigationContext()
  return createElement('output', {
    'data-testid': 'heading-context',
    'data-heading': String(context.heading ?? ''),
    'data-source': context.headingSource,
    'data-status': context.headingStatus,
    'data-can-request': String(context.canRequestHeadingPermission),
  })
}

describe('NavigationContext camera presentation fields', () => {
  it('carries resolved heading status additively without changing route segment state', () => {
    render(createElement(
      NavigationProvider,
      {
        heading: 359,
        headingSource: 'gps',
        headingStatus: 'gps-fallback',
        canRequestHeadingPermission: true,
        route: null,
      },
      createElement(HeadingContextProbe),
    ))

    expect(screen.getByTestId('heading-context')).toHaveAttribute('data-heading', '359')
    expect(screen.getByTestId('heading-context')).toHaveAttribute('data-source', 'gps')
    expect(screen.getByTestId('heading-context')).toHaveAttribute('data-status', 'gps-fallback')
    expect(screen.getByTestId('heading-context')).toHaveAttribute('data-can-request', 'true')
  })
})
