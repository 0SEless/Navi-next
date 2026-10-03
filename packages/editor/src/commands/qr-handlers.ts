import { recordChange } from '@navi/core'
import type { CampusDocument, LocalCoord } from '@navi/core'
import { encodeQrCode, parseQrCode } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { genId } from '../id'

export const qrCreateHandler: CommandHandler = {
  id: 'qr.create',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const id = (payload.id as string) || genId('qr')
    const label = (payload.label as string) || ''
    // P1-T4 (D9): QR checkpoint positions are building-local.
    const position = payload.position as LocalCoord | undefined
    const floor = (payload.floor as number) ?? 0
    const buildingId = (payload.buildingId as string) || ''

    if (!position) return { success: false, error: 'QR checkpoint position is required' }

    // P1-T13 (R10.1/D16/Q5): the QR payload is the opaque checkpoint id —
    // exactly `navi.app/q/{id}`. A client-supplied code must already be the
    // opaque form of THIS id (coordinates or foreign ids are rejected).
    const suppliedCode = payload.code as string | undefined
    let code: string
    if (suppliedCode !== undefined) {
      if (parseQrCode(suppliedCode) !== id) {
        return { success: false, error: `Invalid QR code: must be the opaque form navi.app/q/${id} (no coordinates embedded, D16/Q5)` }
      }
      code = suppliedCode
    } else {
      code = encodeQrCode(id)
    }

    document.qrCheckpoints.push({ id, label, position, floor, buildingId, code, metadata: {} })

    recordChange(document, { entityId: id, entityType: 'checkpoint', operation: 'created' })
    return { success: true, entityId: id, data: { id } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const id = (result.data?.id as string) || payload.id as string
    return { id: 'qr.delete', label: 'Undo Create QR', payload: { qrId: id } }
  },
}

export const qrUpdateHandler: CommandHandler = {
  id: 'qr.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const qrId = payload.qrId as string
    const patch = (payload.patch as Record<string, unknown>) ?? {}
    const qr = document.qrCheckpoints.find(q => q.id === qrId)
    if (!qr) return { success: false, error: `QR checkpoint not found: ${qrId}` }

    // P1-T13 (R10.1): the opaque code is IMMUTABLE — it is derived from the
    // id; moving a checkpoint never changes its encoded content.
    if (patch.code !== undefined) {
      return { success: false, error: 'QR code is immutable — it is the opaque form of the checkpoint id (D16/Q5)' }
    }

    if (patch.position !== undefined) {
      const pos = patch.position as LocalCoord
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
        return { success: false, error: 'QR checkpoint position must be a building-local LocalCoord ({x, y} meters)' }
      }
    }

    const old = { label: qr.label, position: { ...qr.position } }
    if (patch.label != null) qr.label = patch.label as string
    if (patch.position != null) {
      const pos = patch.position as LocalCoord
      qr.position = { x: pos.x, y: pos.y }
    }

    recordChange(document, { entityId: qrId, entityType: 'checkpoint', operation: 'updated' })
    return { success: true, entityId: qrId, data: { old } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    const old = result.data?.old as { label: string; position: LocalCoord } | undefined
    if (!old) return null
    return {
      id: 'qr.update',
      label: 'Undo QR Update',
      payload: { qrId: payload.qrId as string, patch: old },
    }
  },
}

export const qrDeleteHandler: CommandHandler = {
  id: 'qr.delete',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const qrId = payload.qrId as string
    const index = document.qrCheckpoints.findIndex(q => q.id === qrId)
    if (index === -1) return { success: false, error: `QR checkpoint not found: ${qrId}` }

    document.qrCheckpoints.splice(index, 1)
    recordChange(document, { entityId: qrId, entityType: 'checkpoint', operation: 'deleted' })
    return { success: true, entityId: qrId }
  },
  inverse(): Command | null {
    return null
  },
}
