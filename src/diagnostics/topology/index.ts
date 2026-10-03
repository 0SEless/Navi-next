import type { Diagnostic, TopologyRule } from '../diagnostic-types'
import type { CampusDocument } from '@navi/core'
import { StairConnectionRule } from './stair-connection'
import { ElevatorConnectionRule } from './elevator-connection'
import { EntranceRule } from './entrance-rule'

const topologyRules: TopologyRule[] = [
  StairConnectionRule,
  ElevatorConnectionRule,
  EntranceRule,
]

export function topologyDiagnostics(document: CampusDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const rule of topologyRules) {
    try {
      diagnostics.push(...rule.check(document))
    } catch (err) {
      console.warn(`[DiagnosticEngine] Topology rule "${rule.id}" failed:`, err)
    }
  }
  return diagnostics
}
