import { describe, it, expect } from 'vitest'
import type { Diagnostic, DiagnosticCode, DiagnosticProvider } from '../diagnostic-types'

describe('Diagnostic types', () => {
  it('can create a valid Diagnostic', () => {
    const d: Diagnostic = {
      id: 'diag-1',
      code: 'PARAMETER_OUT_OF_RANGE',
      category: 'parameter',
      severity: 'error',
      title: 'Out of range',
      message: 'Step count must be at least 1',
      provider: 'parameter',
    }
    expect(d.id).toBe('diag-1')
    expect(d.code).toBe('PARAMETER_OUT_OF_RANGE')
    expect(d.severity).toBe('error')
  })

  it('can create a Diagnostic with target', () => {
    const d: Diagnostic = {
      id: 'diag-2', code: 'TOPOLOGY_STAIR_DISCONNECTED', category: 'topology',
      severity: 'warning', title: 'Disconnected', message: 'Stair is far from hallway',
      provider: 'topology', rule: 'stair-connection',
      target: { entityType: 'component', entityId: 'pc-1', position: { x: 10, y: 20 } },
    }
    expect(d.target?.entityType).toBe('component')
    expect(d.target?.position).toEqual({ x: 10, y: 20 })
  })

  it('DiagnosticProvider interface is structural', () => {
    const provider: DiagnosticProvider = {
      id: 'test', category: 'parameter',
      run: () => [],
    }
    expect(provider.run()).toEqual([])
  })

  it('DiagnosticCode is a string union', () => {
    const code: DiagnosticCode = 'PARAMETER_OUT_OF_RANGE'
    expect(typeof code).toBe('string')
  })
})
