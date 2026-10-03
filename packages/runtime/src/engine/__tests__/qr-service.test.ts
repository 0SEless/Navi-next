import { describe, it, expect } from 'vitest'
import { QrService } from '../qr-service'
import type { QrIndex } from '@navi/core'
import type { LoadedPackage } from '../../loader'

// P1-T13 (R10.2/D16): QR resolution is local-first (bundle index) with
// API/server lookup fallback; both failing yields a clear error.

function makeIndex(): QrIndex {
  return {
    schemaVersion: 1,
    formatVersion: 0,
    campusId: 'campus-1',
    checkpoints: [
      { id: 'qr-1', label: 'Main Plaza', buildingId: 'b1', floor: 0, position: { x: 5, y: 8 }, code: 'navi.app/q/qr-1' },
      { id: 'qr-2', label: 'Stair Lobby', buildingId: 'b1', floor: 1, position: { x: 25, y: 5 }, code: 'navi.app/q/qr-2' },
    ],
  }
}

function makePkg(qrIndex?: QrIndex): LoadedPackage {
  return {
    manifest: null as unknown as LoadedPackage['manifest'],
    graph: null as unknown as LoadedPackage['graph'],
    reports: [],
    warnings: [],
    qrIndex,
  }
}

describe('P1-T13: QrService resolution (R10.2)', () => {
  it('resolves every QR id from the bundle index (local-first, offline)', async () => {
    const svc = new QrService(makePkg(makeIndex()))
    const a = await svc.resolve('qr-1')
    expect(a?.position).toEqual({ x: 5, y: 8 })
    expect(a?.floor).toBe(0)
    expect(a?.buildingId).toBe('b1')
    const b = await svc.resolve('qr-2')
    expect(b?.position).toEqual({ x: 25, y: 5 })
    // Never touched the fallback
    expect(svc.fallbackCalls).toBe(0)
  })

  it('falls back to the API/server path when the local index misses', async () => {
    const remote = { id: 'qr-remote', label: 'Remote', buildingId: 'b9', floor: 3, position: { x: 1, y: 1 }, code: 'navi.app/q/qr-remote' }
    const svc = new QrService(makePkg(makeIndex()), async (id) => (id === 'qr-remote' ? remote : null))
    const found = await svc.resolve('qr-remote')
    expect(found?.buildingId).toBe('b9')
    expect(svc.fallbackCalls).toBe(1)
  })

  it('reports a clear unknown-checkpoint error when local AND API both fail', async () => {
    const svc = new QrService(makePkg(makeIndex()), async () => null)
    const result = await svc.resolve('qr-ghost')
    expect(result).toBeNull()
    expect(svc.lastError).toMatch(/unknown checkpoint/i)
    expect(svc.lastError).toContain('qr-ghost')
  })

  it('works with no API fallback at all (offline bundle)', async () => {
    const svc = new QrService(makePkg(makeIndex()))
    const found = await svc.resolve('qr-1')
    expect(found?.id).toBe('qr-1')
    const missing = await svc.resolve('qr-nope')
    expect(missing).toBeNull()
    expect(svc.lastError).toMatch(/unknown checkpoint/i)
  })
})