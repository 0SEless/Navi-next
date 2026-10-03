import type { NavNode } from '@/types/nav-types'
import type { QrIndex, QrIndexEntry } from '@navi/core'

/**
 * QR payload format for NAVI location codes.
 *
 * Format: `navi://<campusId>/navigate?node=<nodeId>`
 * - `<campusId>` — the campus this code belongs to (e.g. `asu-ibajay`)
 * - `<nodeId>` — the routable GRAPH node id (never a component id — see
 *   ERRORS.md 2026-08-02)
 *
 * Legacy scanners also accept a bare node id or a URL carrying only
 * `?node=<id>` (the QRScanner component's original format).
 */
export const QR_PROTOCOL = 'navi://'
export const QR_DEFAULT_CAMPUS = 'asu-ibajay'
export const QR_ID_MAX_LENGTH = 128
export const QR_PUBLIC_HOSTS = ['navi.app', 'www.navi.app'] as const

const STABLE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const LEGACY_NODE_PATTERN = /^[A-Za-z0-9._:/ -]{1,128}$/

export interface QrPayload {
  campusId: string
  nodeId: string
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function isStableQrId(value: string): boolean {
  return value.length <= QR_ID_MAX_LENGTH && STABLE_ID_PATTERN.test(value)
}

function isLegacyNodeId(value: string): boolean {
  return value.length <= QR_ID_MAX_LENGTH && LEGACY_NODE_PATTERN.test(value)
}

function isApprovedPublicUrl(url: URL): boolean {
  return url.protocol === 'https:' && QR_PUBLIC_HOSTS.includes(url.hostname as typeof QR_PUBLIC_HOSTS[number])
}

/** Parse the opaque Phase 1 checkpoint code without treating it as a node id. */
export function parseOpaqueQrCode(text: string): string | null {
  if (!text || text.length > 2048) return null
  const trimmed = text.trim()
  const bare = trimmed.match(/^navi\.app\/q\/([^/?#]+)$/)
  if (bare && isStableQrId(bare[1])) return bare[1]

  try {
    const url = new URL(trimmed)
    if (!isApprovedPublicUrl(url) || url.pathname.split('/').filter(Boolean).length !== 2) return null
    if (url.pathname.split('/')[0] !== '') return null
    const [, route, id] = url.pathname.split('/')
    if (route !== 'q' || !id || url.search || url.hash || !isStableQrId(id)) return null
    return id
  } catch {
    return null
  }
}

export function encodeQrPayload(campusId: string, nodeId: string): string {
  return `${QR_PROTOCOL}${campusId}/navigate?node=${encodeURIComponent(nodeId)}`
}

/**
 * Parse any supported payload text into a QrPayload, or null when the
 * text contains no recognizable node reference.
 */
export function parseQrPayload(text: string): QrPayload | null {
  if (!text || text.length > 2048) return null
  const trimmed = text.trim()

  // P1-T13 (R10.1/D16/Q5): opaque checkpoint code — navi.app/q/{checkpointId}.
  // Carries NO node reference and NO coordinates; resolution goes through the
  // published QR index (app-side scan pipeline lands with P3/R10.3 — the
  // checkpoint id is surfaced here so scanners recognize the new scheme).
  const opaque = parseOpaqueQrCode(trimmed)
  if (opaque) {
    return { campusId: '', nodeId: opaque }
  }

  // navi://<campus>/navigate?node=<id> — canonical (legacy, pre-D16), or
  // https://navi.app/...?...node=<id> — the original public scanner form.
  try {
    const url = new URL(trimmed)
    const isNaviProtocol = url.protocol === 'navi:'
    const isLegacyPublic = isApprovedPublicUrl(url)
    if (url.pathname !== '/navigate' && url.pathname !== '/' && url.pathname !== '/map/navigate') {
      return null
    }
    if (!isNaviProtocol && !isLegacyPublic) return null
    const values = url.searchParams.getAll('node')
    if (values.length !== 1) return null
    const nodeId = safeDecodeURIComponent(values[0].trim())
    if (!nodeId || !isLegacyNodeId(nodeId)) return null
    if (isNaviProtocol) {
      const campusId = safeDecodeURIComponent(url.hostname)
      if (!campusId || !isStableQrId(campusId)) return null
      return { campusId, nodeId }
    }
    return { campusId: QR_DEFAULT_CAMPUS, nodeId }
  } catch {
    // Bare legacy node ids are handled below; unsupported URL schemes fail closed.
  }

  // bare node id (e.g. studio marker codes, manual entry)
  if (isStableQrId(trimmed)) {
    return { campusId: QR_DEFAULT_CAMPUS, nodeId: trimmed }
  }

  return null
}

/**
 * True when a payload explicitly belongs to a different campus than the
 * one currently loaded. Payload forms that carry no campus context
 * (bare ids, legacy `?node=` URLs) default to QR_DEFAULT_CAMPUS and are
 * never foreign — they resolve against whatever campus is loaded.
 */
export function isForeignCampus(
  payload: QrPayload | null,
  currentCampusId: string,
): boolean {
  if (!payload || !payload.campusId) return false
  if (payload.campusId === QR_DEFAULT_CAMPUS) return false
  return payload.campusId !== currentCampusId
}

/**
 * Resolve a scanned payload against the loaded campus graph.
 * Returns the matching node, or null when the node doesn't exist in the
 * loaded campus. Cross-campus rejection must be decided by
 * isForeignCampus BEFORE calling this.
 */
export function resolveQrPayload(
  payload: QrPayload | null,
  nodes: NavNode[],
): NavNode | null {
  if (!payload) return null
  return nodes.find((n) => n.id === payload.nodeId) ?? null
}

export type QrCheckpointResolution =
  | { status: 'resolved'; checkpoint: QrIndexEntry }
  | { status: 'unknown' }
  | { status: 'foreign' }
  | { status: 'unavailable' }

/** Resolve an opaque checkpoint payload through the published campus index. */
export function resolveQrCheckpoint(
  payload: QrPayload | null,
  index: QrIndex | undefined,
  currentCampusId: string | null,
): QrCheckpointResolution {
  if (!payload || !index || !currentCampusId) return { status: 'unavailable' }
  if (
    typeof index.campusId !== 'string'
    || !Array.isArray(index.checkpoints)
  ) return { status: 'unavailable' }
  if (index.campusId !== currentCampusId) return { status: 'foreign' }
  if (payload.campusId && payload.campusId !== currentCampusId) {
    return { status: 'foreign' }
  }
  const checkpoint = index.checkpoints.find(
    (entry) => entry && typeof entry.id === 'string' && entry.id === payload.nodeId,
  )
  return checkpoint ? { status: 'resolved', checkpoint } : { status: 'unknown' }
}
