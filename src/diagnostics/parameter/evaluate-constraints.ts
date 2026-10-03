import type { Diagnostic, DiagnosticCode } from '../diagnostic-types'
import type { ParametricComponent, ParametricDefinition } from '@/types/parametric-types'

let diagCounter = 0

function nextId(): string {
  return `diag-${++diagCounter}`
}

export function evaluateConstraints(
  component: ParametricComponent,
  definition: ParametricDefinition,
): Diagnostic[] {
  if (!definition || !definition.constraints) {
    return [{
      id: nextId(), code: 'PARAMETER_REQUIRED' as DiagnosticCode,
      category: 'parameter', severity: 'error',
      title: 'Unknown Definition', message: `Unknown definition: ${component.definitionId}`,
      provider: 'parameter',
      target: { entityType: 'component', entityId: component.id },
    }]
  }

  const diagnostics: Diagnostic[] = []
  for (const c of definition.constraints()) {
    const val = component.properties[c.field]
    if (c.type === 'min' && c.value != null && (val as number) < c.value) {
      diagnostics.push({
        id: nextId(), code: 'PARAMETER_OUT_OF_RANGE',
        category: 'parameter', severity: 'error',
        title: 'Value Too Low', message: c.message,
        provider: 'parameter',
        target: { entityType: 'component', entityId: component.id },
      })
    }
    if (c.type === 'max' && c.value != null && (val as number) > c.value) {
      diagnostics.push({
        id: nextId(), code: 'PARAMETER_OUT_OF_RANGE',
        category: 'parameter', severity: 'error',
        title: 'Value Too High', message: c.message,
        provider: 'parameter',
        target: { entityType: 'component', entityId: component.id },
      })
    }
    if (c.type === 'required' && (val == null || val === '')) {
      diagnostics.push({
        id: nextId(), code: 'PARAMETER_REQUIRED',
        category: 'parameter', severity: 'error',
        title: 'Required Field Missing', message: c.message,
        provider: 'parameter',
        target: { entityType: 'component', entityId: component.id },
      })
    }
  }
  return diagnostics
}
