import type { Diagnostic, TopologyRule } from '../diagnostic-types'
import type { CampusDocument } from '@navi/core'
import { TOPOLOGY_THRESHOLDS } from '../thresholds'

function pointDistance(a: { x: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function nearestPathDistance(elevPos: { x: number }, floor: any): number {
  let minDist = Infinity
  for (const hw of floor.hallways || []) {
    for (const pt of hw.polyline?.points || []) {
      minDist = Math.min(minDist, pointDistance(elevPos, pt))
    }
  }
  return minDist === Infinity ? Infinity : minDist
}

export const ElevatorConnectionRule: TopologyRule = {
  id: 'elevator-connection',
  description: 'Warn if an elevator has no nearby hallway or path',
  check(document: CampusDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    let idCounter = 0
    for (const building of document.buildings) {
      for (const floor of building.floors) {
        if (!floor.parametricComponents) continue
        for (const pc of floor.parametricComponents) {
          if (pc.definitionId !== 'elevator') continue
          const dist = nearestPathDistance(pc.position, floor)
          if (dist > TOPOLOGY_THRESHOLDS.elevatorHallwayMaxDistance) {
            diagnostics.push({
              id: `diag-${++idCounter}`, code: 'TOPOLOGY_ELEVATOR_DISCONNECTED',
              category: 'topology', severity: 'warning',
              title: 'Disconnected Elevator',
              message: `This elevator is ${Math.round(dist)}m from the nearest path (max ${TOPOLOGY_THRESHOLDS.elevatorHallwayMaxDistance}m)`,
              provider: 'topology', rule: 'elevator-connection',
              target: { entityType: 'component', entityId: pc.id },
            })
          }
        }
      }
    }
    return diagnostics
  },
}
