import type { Diagnostic, TopologyRule } from '../diagnostic-types'
import type { CampusDocument } from '@navi/core'
import { TOPOLOGY_THRESHOLDS } from '../thresholds'

// P1-T4 (D9): entrances and hallway geometry are both building-local — the
// distance check is now a consistent local-vs-local comparison (this also
// removes the previous mixed world/local units wart).
function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function nearestHallwayEntranceDist(entPos: { x: number; y: number }, floor: any): number {
  let minDist = Infinity
  for (const hw of floor.hallways || []) {
    for (const pt of hw.polyline?.points || []) {
      minDist = Math.min(minDist, pointDistance(entPos, pt))
    }
  }
  return minDist === Infinity ? Infinity : minDist
}

export const EntranceRule: TopologyRule = {
  id: 'entrance-connection',
  description: 'Warn if an entrance is not connected to a hallway',
  check(document: CampusDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    let idCounter = 0
    for (const building of document.buildings) {
      for (const floor of building.floors) {
        for (const ent of floor.entrances || []) {
          const dist = nearestHallwayEntranceDist(ent.position, floor)
          if (dist > TOPOLOGY_THRESHOLDS.entranceHallwayMaxDistance) {
            diagnostics.push({
              id: `diag-${++idCounter}`, code: 'TOPOLOGY_ENTRANCE_UNATTACHED',
              category: 'topology', severity: 'info',
              title: 'Unattached Entrance',
              message: `Entrance "${ent.label || ent.id}" is ${Math.round(dist)}m from the nearest hallway`,
              provider: 'topology', rule: 'entrance-connection',
              target: {
                entityType: 'entrance', entityId: ent.id,
                buildingId: building.id, floorId: floor.id,
              },
            })
          }
        }
      }
    }
    return diagnostics
  },
}
