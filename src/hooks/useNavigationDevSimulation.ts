'use client'

import { useCallback, useState } from 'react'
import {
  createNavigationDevSimulation,
  isNavigationDevSimulationEnabled,
  nudgeNavigationDevSimulation,
  updateNavigationDevHeading,
  type NavigationDevMoveDirection,
  type NavigationDevSimulationState,
} from '@/lib/navigation-dev-simulation'

export interface UseNavigationDevSimulationResult {
  enabled: boolean
  simulation: NavigationDevSimulationState | null
  setHeading: (heading: number) => void
  nudge: (direction: NavigationDevMoveDirection) => void
}

/** Owns only the opt-in development input; production returns no simulation. */
export function useNavigationDevSimulation(): UseNavigationDevSimulationResult {
  const enabled = isNavigationDevSimulationEnabled()
  const [simulation, setSimulation] = useState<NavigationDevSimulationState>(() => createNavigationDevSimulation())

  const setHeading = useCallback((heading: number) => {
    if (!isNavigationDevSimulationEnabled()) return
    setSimulation((current) => updateNavigationDevHeading(current, heading))
  }, [])

  const nudge = useCallback((direction: NavigationDevMoveDirection) => {
    if (!isNavigationDevSimulationEnabled()) return
    setSimulation((current) => nudgeNavigationDevSimulation(current, direction))
  }, [])

  return {
    enabled,
    simulation: enabled ? simulation : null,
    setHeading,
    nudge,
  }
}
