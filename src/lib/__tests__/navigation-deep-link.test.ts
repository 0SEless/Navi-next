import { describe, expect, it } from 'vitest'
import type { QrIndex } from '@navi/core'
import {
  parseNavigateDeepLink,
  resolveNavigateDeepLink,
  stripNavigateSessionParameters,
  stripNavigateQrParameter,
} from '../navigation-deep-link'

const qrIndex: QrIndex = {
  schemaVersion: 1,
  formatVersion: 1,
  campusId: 'campus-a',
  checkpoints: [
    {
      id: 'checkpoint-1',
      label: 'North Gate',
      buildingId: 'building-a',
      floor: 3,
      position: { x: 4, y: 8 },
      code: 'navi.app/q/checkpoint-1',
    },
  ],
}

describe('parseNavigateDeepLink', () => {
  it('parses the public QR navigation query from the route path', () => {
    expect(parseNavigateDeepLink('/map/navigate?qr=checkpoint-1')).toEqual({
      kind: 'qr',
      checkpointId: 'checkpoint-1',
    })
  })

  it('accepts the canonical public host and preserves an exact destination', () => {
    expect(parseNavigateDeepLink('https://navi.app/map/navigate?qr=checkpoint-1&to=room-42')).toEqual({
      kind: 'qr',
      checkpointId: 'checkpoint-1',
      toNodeId: 'room-42',
    })
  })

  it('rejects empty or non-opaque QR query values', () => {
    expect(parseNavigateDeepLink('?qr=')).toEqual({
      kind: 'invalid',
      reason: 'malformed-qr',
    })
    expect(parseNavigateDeepLink('?qr=checkpoint%2Fone')).toEqual({
      kind: 'invalid',
      reason: 'malformed-qr',
    })
  })

  it('fails closed for arbitrary hosts, unsupported paths, duplicates, and oversized values', () => {
    expect(parseNavigateDeepLink('https://evil.example/map/navigate?qr=checkpoint-1')).toEqual({
      kind: 'invalid',
      reason: 'unsupported-url',
    })
    expect(parseNavigateDeepLink('/map/explore?qr=checkpoint-1')).toEqual({
      kind: 'invalid',
      reason: 'unsupported-url',
    })
    expect(parseNavigateDeepLink('?qr=checkpoint-1&qr=checkpoint-2')).toEqual({
      kind: 'invalid',
      reason: 'malformed-qr',
    })
    expect(parseNavigateDeepLink(`?qr=${'x'.repeat(129)}`)).toEqual({
      kind: 'invalid',
      reason: 'malformed-qr',
    })
  })

  it('preserves legacy node links and explicit destination links', () => {
    expect(parseNavigateDeepLink('?node=node-42')).toEqual({
      kind: 'legacy-node',
      nodeId: 'node-42',
    })
    expect(parseNavigateDeepLink('?to=room-42&from=gate-1')).toEqual({
      kind: 'destination',
      toNodeId: 'room-42',
      fromNodeId: 'gate-1',
    })
  })

  it('rejects duplicate destination origins instead of selecting the first', () => {
    expect(parseNavigateDeepLink('?to=room-42&from=gate-1&from=gate-2')).toEqual({
      kind: 'invalid',
      reason: 'malformed-destination',
    })
  })

  it('returns none when no navigation query is present', () => {
    expect(parseNavigateDeepLink('/map/navigate')).toEqual({ kind: 'none' })
  })
})

describe('resolveNavigateDeepLink', () => {
  it('resolves an opaque QR id through the exact current-campus index entry', () => {
    expect(
      resolveNavigateDeepLink(parseNavigateDeepLink('?qr=checkpoint-1'), qrIndex, 'campus-a'),
    ).toEqual({ status: 'resolved', checkpoint: qrIndex.checkpoints[0] })
  })

  it('returns explicit unknown, foreign, and unavailable QR states', () => {
    expect(
      resolveNavigateDeepLink(parseNavigateDeepLink('?qr=missing'), qrIndex, 'campus-a'),
    ).toEqual({ status: 'unknown', checkpointId: 'missing' })
    expect(
      resolveNavigateDeepLink(parseNavigateDeepLink('?qr=checkpoint-1'), qrIndex, 'campus-b'),
    ).toEqual({ status: 'foreign', checkpointId: 'checkpoint-1' })
    expect(
      resolveNavigateDeepLink(parseNavigateDeepLink('?qr=checkpoint-1'), undefined, 'campus-a'),
    ).toEqual({ status: 'unavailable', checkpointId: 'checkpoint-1' })
  })

  it('resolves destinations before navigation setup and keeps legacy nodes compatible', () => {
    expect(
      resolveNavigateDeepLink(
        parseNavigateDeepLink('?to=room-42&from=gate-1'),
        qrIndex,
        'campus-a',
      ),
    ).toEqual({ status: 'destination', toNodeId: 'room-42', fromNodeId: 'gate-1' })
    expect(
      resolveNavigateDeepLink(parseNavigateDeepLink('?node=node-42'), qrIndex, 'campus-a'),
    ).toEqual({ status: 'legacy-node', nodeId: 'node-42' })
  })

  it('does not resolve an invalid QR query into navigation state', () => {
    expect(
      resolveNavigateDeepLink(parseNavigateDeepLink('?qr=bad%2Fid'), qrIndex, 'campus-a'),
    ).toEqual({ status: 'invalid', reason: 'malformed-qr' })
    expect(resolveNavigateDeepLink({ kind: 'none' }, qrIndex, 'campus-a')).toEqual({
      status: 'none',
    })
  })

  it('maps a QR destination handoff into status-shaped output', () => {
    expect(
      resolveNavigateDeepLink(
        parseNavigateDeepLink('?qr=checkpoint-1&to=room-42'),
        qrIndex,
        'campus-a',
      ),
    ).toEqual({
      status: 'resolved',
      checkpoint: qrIndex.checkpoints[0],
      toNodeId: 'room-42',
    })
  })

  it('removes only qr while preserving destination parameters', () => {
    expect(stripNavigateQrParameter('/map/navigate?qr=checkpoint-1&to=room-42')).toBe(
      '/map/navigate?to=room-42',
    )
  })

  it('removes route-driving parameters while preserving unrelated safe parameters', () => {
    expect(stripNavigateSessionParameters(
      '/map/navigate?from=gate-1&to=room-42&qr=checkpoint-1&ref=profile&view=compact',
    )).toBe('/map/navigate?ref=profile&view=compact')
  })
})
