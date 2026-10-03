import type { DiagnosticProvider, EngineOptions, EngineResult } from './diagnostic-types'
import { ParameterDiagnostics, parameterDiagnostics } from './parameter/index'
import { topologyDiagnostics } from './topology/index'
import type { CampusDocument } from '@navi/core'

const defaultProviders: DiagnosticProvider[] = [
  ParameterDiagnostics,
  { id: 'topology', category: 'topology', run: (doc: any) => topologyDiagnostics(doc as CampusDocument) },
]

export const DiagnosticEngine = {
  run(document: CampusDocument, options?: EngineOptions): EngineResult {
    const diagnostics: any[] = []
    const skippedProviders: string[] = []
    const errors: { provider: string; error: string }[] = []

    for (const provider of defaultProviders) {
      if (options && options[provider.category] === false) {
        skippedProviders.push(provider.id)
        continue
      }
      try {
        diagnostics.push(...provider.run(document))
      } catch (err) {
        errors.push({ provider: provider.id, error: String(err) })
        console.warn(`[DiagnosticEngine] Provider "${provider.id}" failed:`, err)
      }
    }

    return { diagnostics, skippedProviders, errors }
  },
}
