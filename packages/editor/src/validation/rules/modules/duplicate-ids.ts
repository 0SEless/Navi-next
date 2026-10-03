import type { ValidationRule, ValidationContext } from '../types'
import type { ValidationIssue } from '../../snapshot'

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

export const duplicateIdsRule: ValidationRule = {
  ruleId: 'duplicate-ids',
  description: 'Duplicate IDs',
  category: 'duplicate',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'global',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const seen = new Map<string, string[]>()

    for (const bld of context.document.buildings) {
      addId(seen, bld.id, `Building "${bld.name}"`)
      for (const floor of bld.floors) {
        addId(seen, floor.id, `Floor "${floor.label}"`)
        for (const room of floor.rooms) addId(seen, room.id, `Room "${room.name}"`)
        for (const hw of floor.hallways) addId(seen, hw.id, `Hallway "${hw.name}"`)
        for (const st of floor.staircases) addId(seen, st.id, `Staircase "${st.name}"`)
        for (const el of floor.elevators) addId(seen, el.id, `Elevator "${el.name}"`)
        for (const ent of floor.entrances) addId(seen, ent.id, `Entrance "${ent.label}"`)
      }
    }
    for (const road of context.document.roads) addId(seen, road.id, `Road "${road.id}"`)
    for (const pano of context.document.panoramas) addId(seen, pano.id, `Panorama "${pano.id}"`)
    for (const qr of context.document.qrCheckpoints) addId(seen, qr.id, `QR Checkpoint "${qr.id}"`)

    for (const [id, labels] of seen) {
      if (labels.length > 1) {
        issues.push({
          issueId: `duplicate-ids:${id}:${hash(id)}`,
          ruleId: 'duplicate-ids',
          severity: 'error',
          message: `Duplicate entity ID "${id}" (${labels.join(', ')})`,
          targets: [{ entityId: id, entityType: 'unknown' }],
        })
      }
    }

    return issues
  },
}

function addId(seen: Map<string, string[]>, id: string, label: string): void {
  const entries = seen.get(id)
  if (entries) {
    entries.push(label)
  } else {
    seen.set(id, [label])
  }
}
