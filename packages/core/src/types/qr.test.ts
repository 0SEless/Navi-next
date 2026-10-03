import { describe, it, expect } from 'vitest'
import { encodeQrCode, parseQrCode, QR_CODE_PREFIX } from './qr'

// P1-T13 (R10.1/D16/Q5): QR codes encode the opaque stable checkpoint ID
// `navi.app/q/{qrCheckpointId}` — no coordinates, floor, or buildingId
// embedded. Printed QRs never go stale when markers move.

describe('P1-T13: opaque QR codec (R10.1)', () => {
  it('encodes exactly navi.app/q/{id} — nothing else', () => {
    expect(encodeQrCode('cp-42')).toBe('navi.app/q/cp-42')
    expect(QR_CODE_PREFIX).toBe('navi.app/q/')
  })

  it('round-trips encode → parse', () => {
    expect(parseQrCode(encodeQrCode('cp-42'))).toBe('cp-42')
  })

  it('rejects coordinate-bearing or foreign payloads', () => {
    // A code that embeds coordinates must never parse as a checkpoint
    expect(parseQrCode('navi.app/q/33.42,-111.93')).toBeNull()
    expect(parseQrCode('navi.app/q/14.5|121.0')).toBeNull()
    // Legacy schemes and random text are not opaque checkpoint codes
    expect(parseQrCode('navi://asu-ibajay/navigate?node=N001')).toBeNull()
    expect(parseQrCode('N001')).toBeNull()
    expect(parseQrCode('')).toBeNull()
    expect(parseQrCode('https://example.com')).toBeNull()
  })

  it('accepts any stable id after the prefix', () => {
    expect(parseQrCode('navi.app/q/checkpoint-main-1')).toBe('checkpoint-main-1')
    expect(parseQrCode('  navi.app/q/x  ')).toBe('x')
  })
})