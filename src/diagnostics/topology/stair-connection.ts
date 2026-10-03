import type { Diagnostic, TopologyRule } from '../diagnostic-types'
import type { CampusDocument } from '@navi/core'
import { TOPOLOGY_THRESHOLDS } from '../thresholds'

function pointDistance(a: { x: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function nearestHallwayDistance(stairPos: { x: number }, floor: any): number {
  let minDist = Infinity
  for (const hw of floor.hallways || []) {
    for (const pt of hw.polyline?.points || []) {
      minDist = Math.min(minDist, pointDistance(stairPos, pt))
    }
  }
  return minDist === Infinity ? Infinity : minDist
}

export const StairConnectionRule: TopologyRule = {
  id: 'stair-connection',
  description: 'Warn if a stair is too far from the nearest hallway',
  check(document: CampusDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    let idCounter = 0
    for (const building of document.buildings) {
      for (const floor of building.floors) {
        if (!floor.parametricComponents) continue
        for (const pc of floor.parametricComponents) {
          if (pc.definitionId !== 'stair') continue
          const dist = nearestHallwayDistance(pc.position, floor)
          if (dist > TOPOLOGY_THRESHOLDS.stairHallwayMaxDistance) {
            diagnostics.push({
              id: `diag-${++idCounter}`, code: 'TOPOLOGY_STAIR_DISCONNECTED',
              category: 'topology', severity: 'warning',
              title: 'Disconnected Stair',
              message: `This stair is ${Math.round(dist)}m from the nearest hallway (max ${TOPOLOGY_THRESHOLDS.stairHallwayMaxDistance}m)`,
              provider: 'topology', rule: 'stair-connection',
              target: { entityType: 'component', entityId: pc.id },
            })
          }
        }
      }
    }
    return diagnostics
  },
}
