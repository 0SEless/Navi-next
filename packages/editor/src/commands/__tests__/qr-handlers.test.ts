import { describe, it, expect } from 'vitest'
import type { CampusDocument, LocalCoord } from '@navi/core'
import { encodeQrCode } from '@navi/core'
import { qrCreateHandler, qrUpdateHandler } from '../qr-handlers'

// P1-T13 (R10.1/D16/Q5): QR checkpoint codes are opaque — exactly
// `navi.app/q/{checkpointId}`, no coordinates. Moving a checkpoint never
// changes its encoded content.

function createTestDoc(): CampusDocument {
  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'test-campus', name: 'Test Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [
      {
        id: 'bld-1', name: 'Test Building', code: 'TB', category: 'academic', description: '',
        footprint: { points: [{ lat: 33.42, lng: -111.93 }, { lat: 33.421, lng: -111.93 }, { lat: 33.421, lng: -111.929 }, { lat: 33.42, lng: -111.929 }, { lat: 33.42, lng: -111.93 }] },
        baseElevation: 0, height: 20,
        floors: [
          { id: 'flr-0', level: 0, label: 'Ground', elevation: 0, height: 4, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} },
        ],
        verticalConnectors: [], aliases: [], color: '#ff0000', metadata: {},
      },
    ],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function getQr(doc: CampusDocument, id: string) {
  const qr = doc.qrCheckpoints.find(q => q.id === id)
  if (!qr) throw new Error(`qr not found: ${id}`)
  return qr
}

describe('P1-T13: QR checkpoint opaque codes (R10.1)', () => {
  it('create derives the opaque code navi.app/q/{id} when none is supplied', () => {
    const doc = createTestDoc()
    const result = qrCreateHandler.execute(doc, {
      id: 'cp-main', label: 'Main Plaza',
      position: { x: 5, y: 8 }, floor: 0, buildingId: 'bld-1',
    })
    expect(result.success).toBe(true)
    expect(getQr(doc, 'cp-main').code).toBe(encodeQrCode('cp-main'))
    expect(getQr(doc, 'cp-main').code).toBe('navi.app/q/cp-main')
  })

  it('rejects a supplied code that is not the opaque form of the id', () => {
    const doc = createTestDoc()
    const bad = qrCreateHandler.execute(doc, {
      id: 'cp-main', label: 'Main Plaza',
      position: { x: 5, y: 8 }, floor: 0, buildingId: 'bld-1',
      code: 'navi.app/q/other-id',
    })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/opaque|navi\.app\/q/i)
    expect(doc.qrCheckpoints).toHaveLength(0)

    // Coordinates embedded in a code are rejected outright
    const coordCode = qrCreateHandler.execute(doc, {
      id: 'cp-main', label: 'Main Plaza',
      position: { x: 5, y: 8 }, floor: 0, buildingId: 'bld-1',
      code: 'navi.app/q/33.42,-111.93',
    })
    expect(coordCode.success).toBe(false)
    expect(doc.qrCheckpoints).toHaveLength(0)
  })

  it('moving a QR checkpoint changes position only — encoded content unchanged (R10.1)', () => {
    const doc = createTestDoc()
    qrCreateHandler.execute(doc, {
      id: 'cp-main', label: 'Main Plaza', position: { x: 5, y: 8 }, floor: 0, buildingId: 'bld-1',
    })
    const before = getQr(doc, 'cp-main').code

    const moved = qrUpdateHandler.execute(doc, { qrId: 'cp-main', patch: { position: { x: 99, y: 100 } } })
    expect(moved.success).toBe(true)
    expect(getQr(doc, 'cp-main').position).toEqual({ x: 99, y: 100 })
    expect(getQr(doc, 'cp-main').code).toBe(before)

    // Undo restores the previous position; code still untouched
    const inverse = qrUpdateHandler.inverse?.({ qrId: 'cp-main' }, moved) ?? null
    expect(inverse).not.toBeNull()
    const undone = qrUpdateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(getQr(doc, 'cp-main').position).toEqual({ x: 5, y: 8 } as LocalCoord)
    expect(getQr(doc, 'cp-main').code).toBe(before)
  })

  it('code is immutable through the update command', () => {
    const doc = createTestDoc()
    qrCreateHandler.execute(doc, {
      id: 'cp-main', label: 'Main Plaza', position: { x: 5, y: 8 }, floor: 0, buildingId: 'bld-1',
    })
    const patch = qrUpdateHandler.execute(doc, { qrId: 'cp-main', patch: { code: 'navi.app/q/hacked' } })
    expect(patch.success).toBe(false)
    expect(patch.error).toMatch(/immutable|code/i)
    expect(getQr(doc, 'cp-main').code).toBe('navi.app/q/cp-main')
  })

  it('update validates positions and unknown ids', () => {
    const doc = createTestDoc()
    qrCreateHandler.execute(doc, {
      id: 'cp-main', label: 'Main Plaza', position: { x: 5, y: 8 }, floor: 0, buildingId: 'bld-1',
    })
    const badPos = qrUpdateHandler.execute(doc, { qrId: 'cp-main', patch: { position: { x: 'a' } as never } })
    expect(badPos.success).toBe(false)
    expect(badPos.error).toMatch(/position/i)
    const ghost = qrUpdateHandler.execute(doc, { qrId: 'cp-ghost', patch: { position: { x: 1, y: 1 } } })
    expect(ghost.success).toBe(false)
    expect(ghost.error).toMatch(/not found/i)
  })
})