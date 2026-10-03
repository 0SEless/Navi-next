import type { LocalCoord } from './coordinates'

// ── P1-T13 (R10.1/D16/Q5): opaque QR checkpoint codes ──
// QR codes encode the opaque stable checkpoint ID `navi.app/q/{qrCheckpointId}`.
// NO coordinates, floor, or buildingId are ever embedded — printed QRs never
// go stale when markers move. Resolution happens through the published QR
// index (ID → buildingId/floor/position), never through the payload.

export const QR_CODE_PREFIX = 'navi.app/q/'

/** Encode a checkpoint id into its opaque QR payload. */
export function encodeQrCode(id: string): string {
  return `${QR_CODE_PREFIX}${id}`
}

/**
 * Parse a scanned payload into a checkpoint id — ONLY the opaque form
 * (`navi.app/q/{id}`) is accepted; the id itself is restricted to the
 * stable-id charset (letters, digits, `.`, `_`, `-`). Coordinate-bearing
 * payloads (e.g. `navi.app/q/33.42,-111.93`), legacy, or foreign payloads
 * return null: they are not checkpoint codes.
 */
export function parseQrCode(text: string): string | null {
  const trimmed = text?.trim() ?? ''
  if (!trimmed.startsWith(QR_CODE_PREFIX)) return null
  const id = trimmed.slice(QR_CODE_PREFIX.length)
  if (id.length === 0) return null
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null
  return id
}

/** Published QR index artifact (R10.2): ID → building/floor/position. */
export interface QrIndex {
  schemaVersion: number
  formatVersion: number
  campusId: string
  checkpoints: QrIndexEntry[]
}

export interface QrIndexEntry {
  id: string
  label: string
  buildingId: string
  floor: number
  /** Building-local meters (D9) — world derived via CoordinateTransformer. */
  position: LocalCoord
  /** Opaque payload — exactly `navi.app/q/{id}` (D16/Q5). */
  code: string
}