import type { Building, Component, LatLng } from '@/types/nav-types'
import type { DiagnosticSeverity } from '@/diagnostics/diagnostic-types'
import type { CampusDocument } from '@navi/core'
import type { ValidationIssue } from '@navi/editor/src/validation/snapshot'
import { validateRouteNetwork } from '@navi/editor/src/validation/rules/modules/route-network'

export interface ValidationCheck {
  id: string
  code: string
  severity: DiagnosticSeverity
  title: string
  message: string
  entityId?: string
  entityType?: string
  ruleId?: string
  buildingId?: string
  floorId?: string
  layer?: 'base' | 'architecture' | 'access' | 'navigation' | 'preview'
}

const ROUTE_RULE_TITLES: Record<string, string> = {
  'route-network-structure': 'Invalid route network',
  'route-network-disconnected': 'Disconnected route network',
  'route-room-access': 'Room route access is invalid',
  'route-entrance-access': 'Entrance route access is invalid',
  'route-floor-consistency': 'Route node is on the wrong floor',
}

function routeIssueToCheck(issue: ValidationIssue): ValidationCheck {
  const target = issue.targets.find((candidate) => candidate.entityType !== 'floor') ?? issue.targets[0]
  return {
    id: issue.issueId,
    code: issue.ruleId.replaceAll('-', '_').toUpperCase(),
    severity: issue.severity,
    title: ROUTE_RULE_TITLES[issue.ruleId] ?? 'Route network issue',
    message: issue.message,
    entityId: target?.entityId,
    entityType: target?.entityType,
    ruleId: issue.ruleId,
    buildingId: issue.buildingId,
    floorId: issue.floorId,
    layer: issue.layer ?? 'navigation',
  }
}

function pointDistance(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const a2 = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng
  return R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2))
}

/** Minimal road shape expected by the entrance-road check. */
export interface RoadLike {
  id: string
  polyline?: { points?: LatLng[] }
}

export function runValidationChecks(
  building: Building,
  floorIndex: number,
  components: Component[],
  allBuildings?: Building[],
  roads?: RoadLike[],
  editorDocument?: CampusDocument,
): ValidationCheck[] {
  const checks: ValidationCheck[] = []
  if (!building) return checks
  const floorLevel = building.floors?.[floorIndex]
  if (floorLevel === undefined) return checks
  const isGround = floorLevel === 0 || (floorLevel as any) === '0'

  // 1. Missing entrances on ground floor
  if (isGround) {
    const entrances = components.filter(c => c.type === 'entrance')
    if (entrances.length === 0) {
      checks.push({
        id: 'missing-entrance',
        code: 'MISSING_ENTRANCE',
        severity: 'warning',
        title: 'No entrances',
        message: `Building "${building.name}" has no entrances. Visitors cannot enter from outside.`,
        entityId: building.id,
      })
    }
  }

  const rooms = components.filter(c => c.type === 'room' && c.polygon && c.polygon.length >= 3)
  const hallways = components.filter(c => c.type === 'hallway' && c.polygon && c.polygon.length >= 2)

  // 2. Hallway not connected to any room (within 5m)
  for (const hw of hallways) {
    if (!hw.polygon) continue
    const hwPoints = hw.polygon
    let connected = false
    for (const room of rooms) {
      if (!room.polygon) continue
      for (const rp of room.polygon) {
        for (const hp of hwPoints) {
          if (pointDistance(rp, hp) < 5) { connected = true; break }
        }
        if (connected) break
      }
      if (connected) break
    }
    if (!connected) {
      checks.push({
        id: `hw-unconnected-${hw.id}`,
        code: 'HALLWAY_UNCONNECTED',
        severity: 'warning',
        title: 'Hallway not connected',
        message: `"${hw.name}" does not connect to any room within 5m.`,
        entityId: hw.id,
      })
    }
  }

  // 3. Room unreachable (no hallway within 5m)
  for (const room of rooms) {
    if (!room.polygon) continue
    let reachable = false
    for (const hw of hallways) {
      if (!hw.polygon) continue
      for (const rp of room.polygon) {
        for (const hp of hw.polygon) {
          if (pointDistance(rp, hp) < 5) { reachable = true; break }
        }
        if (reachable) break
      }
      if (reachable) break
    }
    if (!reachable) {
      checks.push({
        id: `room-unreachable-${room.id}`,
        code: 'ROOM_UNREACHABLE',
        severity: 'warning',
        title: 'Room unreachable',
        message: `"${room.name}" has no hallway within 5m. Visitors cannot reach this room.`,
        entityId: room.id,
      })
    }
  }

  // 4. Stair not connected to another floor
  const stairs = components.filter(c => c.type === 'stair')
  for (const stair of stairs) {
    const fromLevel = (stair as any).fromLevel
    const toLevel = (stair as any).toLevel
    if (fromLevel == null || toLevel == null || fromLevel === toLevel) {
      checks.push({
        id: `stair-unconnected-${stair.id}`,
        code: 'STAIR_UNCONNECTED',
        severity: 'warning',
        title: 'Stair not connected between floors',
        message: `Stair does not connect two different floors.`,
        entityId: stair.id,
      })
    }
  }

  // 5. Duplicate QR codes
  if (allBuildings) {
    const qrMap = new Map<string, string[]>()
    for (const b of allBuildings) {
      for (const f of b.floors ?? []) {
        for (const qr of (f as any).qrCheckpoints ?? []) {
          const code = qr.code ?? qr.id
          if (!qrMap.has(code)) qrMap.set(code, [])
          qrMap.get(code)!.push(qr.id)
        }
      }
    }
    for (const [code, ids] of qrMap) {
      if (ids.length > 1) {
        checks.push({
          id: `duplicate-qr-${code}`,
          code: 'DUPLICATE_QR',
          severity: 'error',
          title: 'Duplicate QR code',
          message: `QR code "${code}" is used in ${ids.length} locations. Each QR must be unique.`,
          entityId: ids[0],
        })
      }
    }
  }

  // 6. Entrance-to-outdoor-route validation is intentionally delegated to
  // validateRouteNetwork below. In particular, do not infer an assignment
  // from coordinate proximity: the author must choose a node or route
  // segment and save the explicit EntranceAccess relationship.

  // Route validation is shared with the editor ValidationEngine and publish
  // service. Filter the document-wide result to the active building/floor so
  // the Floor Editor shows only actionable issues for the current surface.
  if (editorDocument) {
    const editorBuilding = editorDocument.buildings.find((candidate) => candidate.id === building.id)
    const editorFloorId = editorBuilding?.floors?.[floorIndex]?.id
    checks.push(...validateRouteNetwork(editorDocument, 'publish')
      .filter((issue) => issue.buildingId === building.id && (!editorFloorId || issue.floorId === editorFloorId))
      .map(routeIssueToCheck))
  }

  return checks
}
