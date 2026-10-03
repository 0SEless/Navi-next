import { describe, it, expect } from 'vitest'
import {
  encodeQrPayload,
  isForeignCampus,
  parseQrPayload,
  resolveQrCheckpoint,
  resolveQrPayload,
} from '../qr-payload'
import type { QrIndex } from '@navi/core'
import type { NavNode } from '@/types/nav-types'

const node = (id: string): NavNode => ({
  id,
  label: id,
  position: { lat: 11.82, lng: 122.168 },
  floor: 0,
  buildingId: 'bld-main',
  campusId: 'asu-ibajay',
  type: 'room',
})

describe('encodeQrPayload', () => {
  it('produces the canonical navi:// URL', () => {
    expect(encodeQrPayload('asu-ibajay', 'node-1')).toBe(
      'navi://asu-ibajay/navigate?node=node-1',
    )
  })

  it('URL-encodes node ids', () => {
    expect(encodeQrPayload('asu-ibajay', 'room a/b')).toContain(
      'node=room%20a%2Fb',
    )
  })
})

describe('parseQrPayload', () => {
  it('parses canonical payloads', () => {
    expect(parseQrPayload('navi://asu-ibajay/navigate?node=node-1')).toEqual({
      campusId: 'asu-ibajay',
      nodeId: 'node-1',
    })
  })

  it('parses legacy ?node= URLs (original QRScanner format)', () => {
    expect(parseQrPayload('https://navi.app/?node=node-42&x=1')).toEqual({
      campusId: 'asu-ibajay',
      nodeId: 'node-42',
    })
  })

  it('rejects arbitrary external URLs instead of treating their query as a node payload', () => {
    expect(parseQrPayload('https://evil.example/?node=node-42')).toBeNull()
    expect(parseQrPayload('javascript:alert(1)?node=node-42')).toBeNull()
    expect(parseQrPayload('data:text/plain,node-42')).toBeNull()
  })

  it('rejects duplicate or oversized node values', () => {
    expect(parseQrPayload('https://navi.app/?node=one&node=two')).toBeNull()
    expect(parseQrPayload(`https://navi.app/?node=${'x'.repeat(129)}`)).toBeNull()
  })

  it('URL-decodes node ids with spaces and slashes (?node=room%20a%2Fb)', () => {
    expect(parseQrPayload('https://navi.app/?node=room%20a%2Fb')).toEqual({
      campusId: 'asu-ibajay',
      nodeId: 'room a/b',
    })
  })

  it('URL-decodes percent-encoded dashes (?node=node%2D1)', () => {
    expect(parseQrPayload('navi://asu-ibajay/navigate?node=node%2D1')).toEqual({
      campusId: 'asu-ibajay',
      nodeId: 'node-1',
    })
  })

  it('parses bare node ids', () => {
    expect(parseQrPayload('node-7')).toEqual({
      campusId: 'asu-ibajay',
      nodeId: 'node-7',
    })
  })

  it('rejects garbage', () => {
    expect(parseQrPayload('hello world!')).toBeNull()
    expect(parseQrPayload('')).toBeNull()
    expect(parseQrPayload('   ')).toBeNull()
  })

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(parseQrPayload('navi://asu-ibajay/navigate?node=%E0%A4%A')).toBeNull()
  })

  it('round-trips through encodeQrPayload', () => {
    const enc = encodeQrPayload('asu-ibajay', 'node-3')
    expect(parseQrPayload(enc)).toEqual({ campusId: 'asu-ibajay', nodeId: 'node-3' })
  })
})

describe('resolveQrCheckpoint', () => {
  const index: QrIndex = {
    schemaVersion: 1,
    formatVersion: 1,
    campusId: 'asu-ibajay',
    checkpoints: [
      {
        id: 'checkpoint-1',
        label: 'Main Gate',
        buildingId: 'b1',
        floor: 1,
        position: { x: 1, y: 2 },
        code: 'navi.app/q/checkpoint-1',
      },
    ],
  }

  it('resolves an opaque payload only through its exact published entry', () => {
    expect(resolveQrCheckpoint(parseQrPayload('navi.app/q/checkpoint-1'), index, 'asu-ibajay')).toEqual({
      status: 'resolved',
      checkpoint: index.checkpoints[0],
    })
  })

  it('reports foreign and unavailable indexes without inventing coordinates', () => {
    expect(resolveQrCheckpoint(parseQrPayload('navi.app/q/checkpoint-1'), index, 'other-campus')).toEqual({
      status: 'foreign',
    })
    expect(resolveQrCheckpoint(parseQrPayload('navi.app/q/checkpoint-1'), undefined, 'asu-ibajay')).toEqual({
      status: 'unavailable',
    })
  })
})

describe('resolveQrPayload', () => {
  const nodes = [node('node-1'), node('node-2')]

  it('resolves to an existing node', () => {
    const result = resolveQrPayload(
      parseQrPayload('navi://asu-ibajay/navigate?node=node-2'),
      nodes,
    )
    expect(result?.id).toBe('node-2')
  })

  it('returns null for unknown node ids (cross-campus codes)', () => {
    expect(
      resolveQrPayload(parseQrPayload('navi://other-campus/navigate?node=nope'), nodes),
    ).toBeNull()
  })

  it('returns null for unparsable input', () => {
    expect(resolveQrPayload(null, nodes)).toBeNull()
  })
})

describe('isForeignCampus', () => {
  it('flags canonical codes for another campus', () => {
    expect(
      isForeignCampus(
        parseQrPayload('navi://other-campus/navigate?node=node-1'),
        'asu-ibajay',
      ),
    ).toBe(true)
  })

  it('accepts canonical codes for the loaded campus', () => {
    expect(
      isForeignCampus(
        parseQrPayload('navi://asu-ibajay/navigate?node=node-1'),
        'asu-ibajay',
      ),
    ).toBe(false)
  })

  it('accepts legacy ?node= URLs (no campus context)', () => {
    expect(
      isForeignCampus(parseQrPayload('https://navi.app/?node=node-1'), 'asu-ibajay'),
    ).toBe(false)
  })

  it('accepts bare node ids (no campus context)', () => {
    expect(isForeignCampus(parseQrPayload('node-1'), 'asu-ibajay')).toBe(false)
  })

  it('accepts no-context codes even when a non-default campus is loaded', () => {
    expect(isForeignCampus(parseQrPayload('node-1'), 'other-campus')).toBe(false)
  })

  it('returns false for null payloads', () => {
    expect(isForeignCampus(null, 'asu-ibajay')).toBe(false)
  })
})
