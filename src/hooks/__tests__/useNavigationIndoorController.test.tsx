import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { type ReactNode } from 'react'
import { useNavigationIndoorController } from '../useNavigationIndoorController'
import { NavigationProvider } from '@/components/map/NavigationContext'
import { usePublicStore } from '@/store/public-store'
import type { NavRoute } from '@/types/route-types'

// ── Test Helpers ──────────────────────────────────────────────

function makeRoute(steps: NavRoute['steps']): NavRoute {
  return {
    path: steps.map(s => s.nodeId),
    steps,
    instructions: [],
    totalDistance: 100,
    totalDuration: 0,
    fromLabel: 'Start',
    toLabel: 'End',
    arrival: {
      nodeId: steps[steps.length - 1]?.nodeId ?? '',
      label: '',
      position: { lat: 0, lng: 0 },
      remainingDistance: 0,
    },
    nodeFloors: [...new Set(steps.map(s => s.floor))].sort((a, b) => b - a),
  }
}

function outdoorStep(nodeId: string, buildingId = '') {
  return {
    nodeId,
    label: nodeId,
    position: { lat: 0, lng: 0 },
    floor: 0,
    buildingId,
    type: 'walk' as const,
  }
}

function entranceStep(nodeId: string, buildingId: string, floor = 0) {
  return {
    nodeId,
    label: nodeId,
    position: { lat: 0, lng: 0 },
    floor,
    buildingId,
    type: 'entrance' as const,
  }
}

function indoorStep(nodeId: string, buildingId: string, floor: number) {
  return {
    nodeId,
    label: nodeId,
    position: { lat: 0, lng: 0 },
    floor,
    buildingId,
    type: 'walk' as const,
  }
}

function stairStep(nodeId: string, buildingId: string, floor: number) {
  return {
    nodeId,
    label: nodeId,
    position: { lat: 0, lng: 0 },
    floor,
    buildingId,
    type: 'stairs' as const,
  }
}

function elevatorStep(nodeId: string, buildingId: string, floor: number) {
  return {
    nodeId,
    label: nodeId,
    position: { lat: 0, lng: 0 },
    floor,
    buildingId,
    type: 'elevator' as const,
  }
}

/** Wrapper that provides NavigationContext with given props. */
function makeWrapper(props: {
  buildingId?: string
  floor?: number
  route?: NavRoute | null
  currentNodeId?: string | null
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationProvider
        buildingId={props.buildingId}
        floor={props.floor}
        route={props.route ?? null}
        currentNodeId={props.currentNodeId ?? null}
      >
        {children}
      </NavigationProvider>
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────

describe('W16E: useNavigationIndoorController', () => {
  beforeEach(() => {
    usePublicStore.setState({
      indoorContext: { active: false },
      activeFloor: 0,
      selectedBuilding: null,
    })
  })

  // ── 1–3: Initial State (no navigation) ─────────────────────

  describe('Initial State (no navigation active)', () => {
    it('1. inCampusMode is true when no navigation context', () => {
      const { result } = renderHook(() => useNavigationIndoorController())
      expect(result.current.inCampusMode).toBe(true)
    })

    it('2. activeBuildingId is null when no navigation context', () => {
      const { result } = renderHook(() => useNavigationIndoorController())
      expect(result.current.activeBuildingId).toBeNull()
    })

    it('3. activeFloorId is null when no navigation context', () => {
      const { result } = renderHook(() => useNavigationIndoorController())
      expect(result.current.activeFloorId).toBeNull()
    })
  })

  // ── 4–5: Campus Mode (outdoor segment) ─────────────────────

  describe('Campus Mode (outdoor segment)', () => {
    it('4. inCampusMode is true during outdoor navigation segment', () => {
      const route = makeRoute([
        outdoorStep('A'),
        outdoorStep('B'),
        outdoorStep('C'),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'A' })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.inCampusMode).toBe(true)
    })

    it('5. filteredSteps shows outdoor-only steps in campus mode', () => {
      const route = makeRoute([
        outdoorStep('A'),
        outdoorStep('B'),
        outdoorStep('C'),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'A' })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.filteredSteps).toHaveLength(3)
      expect(result.current.filteredSteps.map(s => s.nodeId)).toEqual(['A', 'B', 'C'])
    })
  })

  // ── 6–7: Entrance → Indoor transition ───────────────────────

  describe('Entrance segment triggers indoor context', () => {
    it('6. entering entrance segment calls enterIndoorContext', () => {
      const route = makeRoute([
        outdoorStep('A'),
        entranceStep('B', 'b1', 0),
        indoorStep('C', 'b1', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 0 })
      renderHook(() => useNavigationIndoorController(), { wrapper })

      const { indoorContext } = usePublicStore.getState()
      expect(indoorContext.active).toBe(true)
      expect(indoorContext.buildingId).toBe('b1')
      expect(indoorContext.floorId).toBe(0)
    })

    it('7. entrance segment sets correct floor', () => {
      const route = makeRoute([
        outdoorStep('A'),
        entranceStep('B', 'b1', 1),
        indoorStep('C', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 1 })
      renderHook(() => useNavigationIndoorController(), { wrapper })

      const { indoorContext } = usePublicStore.getState()
      expect(indoorContext.floorId).toBe(1)
    })
  })

  // ── 8–10: Indoor mode ──────────────────────────────────────

  describe('Indoor mode (indoor segment)', () => {
    it('8. inCampusMode is false during indoor segment', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
        indoorStep('C', 'b1', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 0 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.inCampusMode).toBe(false)
    })

    it('9. activeBuildingId matches current building', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 0 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.activeBuildingId).toBe('b1')
    })

    it('10. activeFloorId matches current floor', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 1),
        indoorStep('B', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 1 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.activeFloorId).toBe(1)
    })
  })

  // ── 11–13: Floor transitions ────────────────────────────────

  describe('Floor transitions', () => {
    it('11. floor-transition segment switches floor in IndoorContext', () => {
      const route = makeRoute([
        indoorStep('A', 'b1', 0),
        stairStep('B', 'b1', 0),
        indoorStep('C', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'C', buildingId: 'b1', floor: 1 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.activeFloorId).toBe(1)
    })

    it('12. floor transition does not show both floors simultaneously', () => {
      const route = makeRoute([
        indoorStep('A', 'b1', 0),
        stairStep('B', 'b1', 0),
        indoorStep('C', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'C', buildingId: 'b1', floor: 1 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      // Only floor 1 steps should be filtered
      expect(result.current.filteredSteps.every(s => s.floor === 1)).toBe(true)
    })

    it('13. elevator transition switches floor correctly', () => {
      const route = makeRoute([
        indoorStep('A', 'b1', 0),
        elevatorStep('B', 'b1', 0),
        indoorStep('C', 'b1', 2),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'C', buildingId: 'b1', floor: 2 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.activeFloorId).toBe(2)
    })
  })

  // ── 14–16: Route segment filtering ──────────────────────────

  describe('Route segment filtering', () => {
    it('14. campus mode filters to outdoor segments only', () => {
      const route = makeRoute([
        outdoorStep('A'),
        outdoorStep('B'),
        entranceStep('C', 'b1', 0),
        indoorStep('D', 'b1', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'A' })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.filteredSteps.map(s => s.nodeId)).toEqual(['A', 'B'])
    })

    it('15. indoor floor 1 filters to floor 1 route segment', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
        indoorStep('C', 'b1', 1),
        indoorStep('D', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 0 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.filteredSteps.every(s => s.floor === 0)).toBe(true)
      expect(result.current.filteredSteps.map(s => s.nodeId)).toEqual(['A', 'B'])
    })

    it('16. indoor floor 2 filters to floor 2 route segment', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
        indoorStep('C', 'b1', 1),
        indoorStep('D', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'D', buildingId: 'b1', floor: 1 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.filteredSteps.every(s => s.floor === 1)).toBe(true)
      expect(result.current.filteredSteps.map(s => s.nodeId)).toEqual(['C', 'D'])
    })
  })

  // ── 17–19: Route start/cancel/complete ──────────────────────

  describe('Route lifecycle', () => {
    it('17. route START sets context based on starting segment', () => {
      const route = makeRoute([
        outdoorStep('A'),
        entranceStep('B', 'b1', 0),
        indoorStep('C', 'b1', 0),
      ])
      // Start route at outdoor node — should stay in campus mode
      const wrapper = makeWrapper({ route, currentNodeId: 'A' })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.inCampusMode).toBe(true)
    })

    it('18. route START from indoor node enters indoor context', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'A', buildingId: 'b1', floor: 0 })
      renderHook(() => useNavigationIndoorController(), { wrapper })

      const { indoorContext } = usePublicStore.getState()
      expect(indoorContext.active).toBe(true)
    })

    it('19. route CANCEL stops automatic context changes', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'A', buildingId: 'b1', floor: 0 })
      const { unmount } = renderHook(() => useNavigationIndoorController(), { wrapper })

      // Verify context was set
      expect(usePublicStore.getState().indoorContext.active).toBe(true)

      // Unmount simulates route cancellation
      unmount()

      // Context should remain (stops automatic changes)
      expect(usePublicStore.getState().indoorContext.active).toBe(true)
    })
  })

  // ── 20–22: Route COMPLETE ──────────────────────────────────

  describe('Route completion', () => {
    it('20. route COMPLETE keeps destination floor visible', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 1),
        indoorStep('C', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'C', buildingId: 'b1', floor: 1 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })

      expect(result.current.activeFloorId).toBe(1)
      expect(result.current.inCampusMode).toBe(false)
    })

    it('21. route COMPLETE preserves building context', () => {
      const route = makeRoute([
        entranceStep('A', 'b2', 0),
        indoorStep('B', 'b2', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b2', floor: 0 })
      renderHook(() => useNavigationIndoorController(), { wrapper })

      const { indoorContext } = usePublicStore.getState()
      expect(indoorContext.buildingId).toBe('b2')
    })

    it('22. NEW ROUTE recalculates presentation', () => {
      // First route into b1
      const route1 = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
      ])
      const wrapper1 = makeWrapper({ route: route1, currentNodeId: 'B', buildingId: 'b1', floor: 0 })
      const { unmount: unmount1 } = renderHook(() => useNavigationIndoorController(), { wrapper: wrapper1 })

      expect(usePublicStore.getState().indoorContext.buildingId).toBe('b1')
      unmount1()

      // New route into b2
      const route2 = makeRoute([
        entranceStep('C', 'b2', 1),
        indoorStep('D', 'b2', 1),
      ])
      const wrapper2 = makeWrapper({ route: route2, currentNodeId: 'C', buildingId: 'b2', floor: 1 })
      renderHook(() => useNavigationIndoorController(), { wrapper: wrapper2 })

      const { indoorContext } = usePublicStore.getState()
      expect(indoorContext.buildingId).toBe('b2')
      expect(indoorContext.floorId).toBe(1)
    })
  })

  // ── 23–24: Cross-building routes ───────────────────────────

  describe('Cross-building routes', () => {
    it('23. Indoor A → Campus Mode transition on exit', () => {
      const route = makeRoute([
        indoorStep('A', 'b1', 0),
        entranceStep('B', 'b1', 0),
        outdoorStep('C'),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'C' })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })

      // Should be in campus mode after exiting building
      expect(result.current.inCampusMode).toBe(true)
    })

    it('24. Campus Mode → Indoor B transition on entry', () => {
      const route = makeRoute([
        outdoorStep('A'),
        entranceStep('B', 'b2', 0),
        indoorStep('C', 'b2', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'C', buildingId: 'b2', floor: 0 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })

      expect(result.current.inCampusMode).toBe(false)
      expect(result.current.activeBuildingId).toBe('b2')
    })

    it('25. IndoorContext is contextual, not permanently tied to destination', () => {
      // Route: b1 → campus → b2
      const route = makeRoute([
        indoorStep('A', 'b1', 0),
        entranceStep('B', 'b1', 0),
        outdoorStep('C'),
        entranceStep('D', 'b2', 0),
        indoorStep('E', 'b2', 0),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'E', buildingId: 'b2', floor: 0 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })

      // Final state is b2, not permanently b1
      expect(result.current.activeBuildingId).toBe('b2')
    })
  })

  // ── 26–27: Manual exploration compatibility ─────────────────

  describe('Manual exploration compatibility', () => {
    it('26. manual Indoor Mode works without navigation', () => {
      // Manually set indoor context (W16C path)
      usePublicStore.getState().enterIndoorContext('b1', 0)

      const { result } = renderHook(() => useNavigationIndoorController())
      // Hook doesn't override manual context when no navigation
      expect(usePublicStore.getState().indoorContext.active).toBe(true)
      expect(usePublicStore.getState().indoorContext.buildingId).toBe('b1')
    })

    it('27. W16E only applies when navigation is active', () => {
      // Set manual indoor context
      usePublicStore.getState().enterIndoorContext('b1', 0)

      // No NavigationProvider wrapper → navigation is null
      const { result } = renderHook(() => useNavigationIndoorController())

      // Manual context preserved, hook doesn't touch it
      expect(usePublicStore.getState().indoorContext.active).toBe(true)
      expect(result.current.navigationSegment).toBeNull()
    })
  })

  // ── 28–30: Edge cases ──────────────────────────────────────

  describe('Edge cases', () => {
    it('28. empty route shows no filtered steps', () => {
      const route = makeRoute([])
      const wrapper = makeWrapper({ route, currentNodeId: null })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })
      expect(result.current.filteredSteps).toHaveLength(0)
    })

    it('29. navigationIndoorMode is independent of selectedBuilding', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
      ])
      // Set selectedBuilding to a DIFFERENT building
      usePublicStore.getState().selectBuilding({
        id: 'b-other',
        name: 'Other',
        campusId: 'c',
        floors: [0],
        footprint: [],
        baseElevation: 0,
        height: 0,
      })

      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 0 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })

      // Navigation controller sets b1, not b-other
      expect(result.current.activeBuildingId).toBe('b1')
    })

    it('30. indoorContext changes from navigation do not affect navigation state', () => {
      const route = makeRoute([
        entranceStep('A', 'b1', 0),
        indoorStep('B', 'b1', 0),
        indoorStep('C', 'b1', 1),
      ])
      const wrapper = makeWrapper({ route, currentNodeId: 'B', buildingId: 'b1', floor: 0 })
      const { result } = renderHook(() => useNavigationIndoorController(), { wrapper })

      // Change indoor context externally (simulating manual floor change)
      act(() => {
        usePublicStore.getState().enterIndoorContext('b2', 2)
      })

      // Navigation context (segment) should remain unchanged
      expect(result.current.navigationSegment).toBe('indoor')
      // But active IDs reflect the external change
      expect(result.current.activeBuildingId).toBe('b2')
      expect(result.current.activeFloorId).toBe(2)
    })
  })
})
