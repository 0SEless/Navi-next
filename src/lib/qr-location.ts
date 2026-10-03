import type { CoordinateTransformer, QrIndexEntry } from '@navi/core'
import { CoordinateTransformer as CoordinateTransformerClass } from '@navi/core'
import type { CampusBundle, LatLng, NavNode } from '@/types/nav-types'
import { resolveNearestNode } from './location-resolver'
import {
  isForeignCampus,
  parseOpaqueQrCode,
  parseQrPayload,
  resolveQrCheckpoint,
  resolveQrPayload,
  type QrPayload,
} from './qr-payload'
import { parseNavigateDeepLink } from './navigation-deep-link'

export type QrLocationAnchor = 'graph-node' | 'coordinate-snap' | 'none'

export interface QrLocation {
  source: 'qr'
  campusId: string
  checkpointId?: string
  label: string
  buildingId?: string
  floor?: number
  position?: LatLng
  nodeId: string | null
  anchor: QrLocationAnchor
}

export type QrScanPayload =
  | { kind: 'checkpoint'; checkpointId: string }
  | { kind: 'legacy-node'; payload: QrPayload }

export type QrScanResolution =
  | { status: 'resolved'; location: QrLocation }
  | { status: 'unknown'; reference: string }
  | { status: 'foreign'; reference: string; campusId?: string }
  | { status: 'unavailable'; reference: string }
  | { status: 'malformed' }

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function checkpointContext(checkpoint: QrIndexEntry): Pick<QrLocation, 'label' | 'buildingId' | 'floor'> {
  return {
    label: nonEmptyString(checkpoint.label) ?? checkpoint.id,
    ...(nonEmptyString(checkpoint.buildingId) ? { buildingId: nonEmptyString(checkpoint.buildingId) } : {}),
    ...(finiteNumber(checkpoint.floor) ? { floor: checkpoint.floor } : {}),
  }
}

function exactQrGraphNode(
  checkpoint: QrIndexEntry,
  campus: CampusBundle,
  campusId: string,
): NavNode | null {
  return campus.nodes.find((node) => {
    if (node.campusId !== campusId) return false
    if (node.metadata?.entityType !== 'qr' || node.metadata.entityId !== checkpoint.id) return false
    if (nonEmptyString(checkpoint.buildingId) && node.buildingId !== checkpoint.buildingId) return false
    if (finiteNumber(checkpoint.floor) && node.floor !== checkpoint.floor) return false
    return true
  }) ?? null
}

function publishedWorldPosition(checkpoint: QrIndexEntry, campus: CampusBundle): LatLng | null {
  const buildingId = nonEmptyString(checkpoint.buildingId)
  const position = checkpoint.position
  if (!buildingId || !position || !finiteNumber(position.x) || !finiteNumber(position.y)) return null

  const building = campus.floorGeometry?.buildings.find((candidate) => candidate.id === buildingId)
  if (!building || !finiteNumber(building.anchor.rotation)) return null
  const origin = building.anchor.origin
  if (!finiteNumber(origin.lat) || !finiteNumber(origin.lng)) return null

  const transformer: CoordinateTransformer = new CoordinateTransformerClass()
  transformer.registerBuilding({
    buildingId,
    origin,
    rotation: building.anchor.rotation,
  })
  return transformer.buildingLocalToWorld({ x: position.x, y: position.y }, buildingId)
}

function coordinateSnap(
  worldPosition: LatLng | null,
  checkpoint: QrIndexEntry,
  campus: CampusBundle,
  campusId: string,
): NavNode | null {
  if (!worldPosition) return null
  const buildingId = nonEmptyString(checkpoint.buildingId)
  const floor = finiteNumber(checkpoint.floor) ? checkpoint.floor : undefined
  const candidates = campus.nodes.filter((node) => (
    node.campusId === campusId
    && (!buildingId || node.buildingId === buildingId)
    && (floor === undefined || node.floor === floor)
  ))
  return resolveNearestNode(candidates, worldPosition, 30)?.node ?? null
}

/** Build a QR-origin view model from one exact published checkpoint entry. */
export function resolveQrCheckpointLocation(
  checkpoint: QrIndexEntry,
  campus: CampusBundle,
  campusId: string,
): QrLocation {
  const context = checkpointContext(checkpoint)
  const exactNode = exactQrGraphNode(checkpoint, campus, campusId)
  const worldPosition = publishedWorldPosition(checkpoint, campus)
  const snappedNode = exactNode ? null : coordinateSnap(worldPosition, checkpoint, campus, campusId)
  const node = exactNode ?? snappedNode
  return {
    source: 'qr',
    campusId,
    checkpointId: checkpoint.id,
    ...context,
    ...(node ? { position: node.position } : worldPosition ? { position: worldPosition } : {}),
    nodeId: node?.id ?? null,
    anchor: exactNode ? 'graph-node' : snappedNode ? 'coordinate-snap' : 'none',
  }
}

function resolveLegacyNodeLocation(node: NavNode, campusId: string): QrLocation {
  return {
    source: 'qr',
    campusId,
    label: nonEmptyString(node.label) ?? node.id,
    ...(nonEmptyString(node.buildingId) ? { buildingId: node.buildingId } : {}),
    ...(finiteNumber(node.floor) ? { floor: node.floor } : {}),
    position: node.position,
    nodeId: node.id,
    anchor: 'graph-node',
  }
}

/** Parse every supported public/in-app QR form through one boundary. */
export function parseQrScanPayload(text: string): QrScanPayload | null {
  const checkpointId = parseOpaqueQrCode(text)
  if (checkpointId) return { kind: 'checkpoint', checkpointId }

  const deepLink = parseNavigateDeepLink(text)
  if (deepLink.kind === 'qr') return { kind: 'checkpoint', checkpointId: deepLink.checkpointId }

  const payload = parseQrPayload(text)
  return payload ? { kind: 'legacy-node', payload } : null
}

/** Resolve a scanned payload against the already hydrated published campus. */
export function resolveQrScanPayload(
  text: string,
  campus: CampusBundle | null | undefined,
  currentCampusId: string | null,
): QrScanResolution {
  const payload = parseQrScanPayload(text)
  if (!payload) return { status: 'malformed' }

  if (payload.kind === 'checkpoint') {
    if (!campus || !currentCampusId) return { status: 'unavailable', reference: payload.checkpointId }
    const resolved = resolveQrCheckpoint(
      { campusId: '', nodeId: payload.checkpointId },
      campus.qrIndex,
      currentCampusId,
    )
    if (resolved.status === 'unknown') return { status: 'unknown', reference: payload.checkpointId }
    if (resolved.status === 'foreign') {
      return {
        status: 'foreign',
        reference: payload.checkpointId,
        campusId: campus.qrIndex?.campusId,
      }
    }
    if (resolved.status === 'unavailable') return { status: 'unavailable', reference: payload.checkpointId }
    return {
      status: 'resolved',
      location: resolveQrCheckpointLocation(resolved.checkpoint, campus, currentCampusId),
    }
  }

  const legacy = payload.payload
  if (isForeignCampus(legacy, currentCampusId ?? '')) {
    return { status: 'foreign', reference: legacy.nodeId, campusId: legacy.campusId }
  }
  if (!campus || !currentCampusId) return { status: 'unavailable', reference: legacy.nodeId }
  const node = resolveQrPayload(legacy, campus.nodes)
  if (!node) return { status: 'unknown', reference: legacy.nodeId }
  return { status: 'resolved', location: resolveLegacyNodeLocation(node, currentCampusId) }
}
