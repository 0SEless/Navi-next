import type { Building, NavNode, NavEdge } from "@/types/nav-types"

// Map TypeScript camelCase property names to snake_case DB column names
const TS_TO_DB: Record<string, string> = {
  campusId: "campus_id",
  buildingId: "building_id",
  componentId: "component_id",
  nodeType: "node_type",
  edgeType: "edge_type",
  fromNode: "from_node_id",
  toNode: "to_node_id",
  svgOffset: "svg_offset",
  hasQr: "has_qr",
  hasPanorama: "has_panorama",
  floorPlanUrl: "floor_plan_url",
  panoramaUrl: "panorama_url",
  createdAt: "created_at",
  updatedAt: "updated_at",
}

export function toSnake(key: string): string {
  return TS_TO_DB[key] ?? key.replace(/([A-Z])/g, "_$1").toLowerCase()
}

export function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

// Transform an object's top-level keys between camelCase and snake_case
export function mapKeys<T>(obj: Record<string, unknown>, mapper: (k: string) => string): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[mapper(key)] = value
  }
  return result as T
}

function validateCoord(lat: number, lng: number): void {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error(`Invalid coordinates: lat=${lat}, lng=${lng}`)
  }
}

// LatLng → PostGIS geography point (lon lat order for ST_MakePoint)
export function toPoint(lat: number, lng: number): string {
  validateCoord(lat, lng)
  return `ST_MakePoint(${lng}, ${lat})::geography`
}

// PostGIS geography → { lat, lng }
export function fromPoint(stX: number, stY: number): { lat: number; lng: number } {
  return { lat: stY, lng: stX }
}

// Line string for building outline
export function toLineString(outline: { lat: number; lng: number }[]): string {
  for (const p of outline) validateCoord(p.lat, p.lng)
  const coords = outline.map((p) => `${p.lng} ${p.lat}`).join(", ")
  return `ST_GeogFromText('SRID=4326;LINESTRING(${coords})')`
}

// Polygon for building outline (closed ring)
export function toPolygon(outline: { lat: number; lng: number }[]): string {
  for (const p of outline) validateCoord(p.lat, p.lng)
  const ring = [...outline, outline[0]]
  const coords = ring.map((p) => `${p.lng} ${p.lat}`).join(", ")
  return `ST_GeogFromText('SRID=4326;POLYGON((${coords}))')`
}

// Serialize a Building to DB row format
export function buildingToRow(b: Building): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: b.id,
    campus_id: b.campusId ?? "asu-ibajay",
    name: b.name,
    code: b.code ?? null,
    description: b.description ?? "",
    floors: b.floors ?? 1,
    color: b.color ?? "#64748B",
    floor_plan_url: (b as unknown as Record<string, unknown>).floorPlanUrl as string ?? null,
  }
  if (b.center) {
    row.center = toPoint(b.center.lat, b.center.lng)
  }
  if (b.outline && b.outline.length >= 3) {
    row.outline = toPolygon(b.outline)
  }
  return row
}

// Serialize a NavNode to DB row format
export function nodeToRow(n: NavNode): Record<string, unknown> {
  return {
    id: n.id,
    campus_id: n.campusId ?? "asu-ibajay",
    building_id: n.buildingId ?? null,
    name: n.label,
    node_type: n.type,
    floor: n.floor,
    position: toPoint(n.position.lat, n.position.lng),
    component_id: n.componentId ?? null,
    svg_offset_x: n.svgOffset?.x ?? null,
    svg_offset_y: n.svgOffset?.y ?? null,
    has_qr: n.hasQr ?? false,
    has_panorama: n.hasPanorama ?? false,
    panorama_url: (n.metadata as Record<string, string> | undefined)?.panoramaUrl ?? null,
    metadata: n.metadata ?? {},
  }
}

// Serialize a NavEdge to DB row format
export function edgeToRow(e: NavEdge): Record<string, unknown> {
  return {
    id: e.id,
    campus_id: "asu-ibajay",
    from_node_id: e.from,
    to_node_id: e.to,
    edge_type: e.type,
    distance: e.distance,
  }
}
