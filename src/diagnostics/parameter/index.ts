import type { Diagnostic, DiagnosticProvider } from '../diagnostic-types'
import type { CampusDocument } from '@navi/core'
import { evaluateConstraints } from './evaluate-constraints'
import { DEFINITIONS } from '@/types/parametric-types'

export function parameterDiagnostics(document: CampusDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      if (!floor.parametricComponents) continue
      for (const pc of floor.parametricComponents) {
        const def = DEFINITIONS[pc.definitionId]
        diagnostics.push(...evaluateConstraints(pc, def as any))
      }
    }
  }
  return diagnostics
}

export const ParameterDiagnostics: DiagnosticProvider = {
  id: 'parameter',
  category: 'parameter',
  run: (document: any) => parameterDiagnostics(document as CampusDocument),
}
