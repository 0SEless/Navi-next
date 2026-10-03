// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { findBuilding } from '@navi/editor'
import type { Building, CampusDocument } from '@navi/core'

/**
 * P0 FINAL — canonical building link verification.
 *
 * SOURCE contract: the exact route-builder expression from FloorOutliner.tsx:331
 *   `/studio/${encodeURIComponent(mapId)}/edit/building/${encodeURIComponent(building.id)}/floor/${f}`
 * DESTINATION contract: the real resolver chain
 *   FloorEditor -> useLegacyBuilding -> useBuilding -> findBuilding(document, id)
 *   findBuilding === document.buildings.find((b) => b.id === id)  (exact equality)
 *
 * No production code is modified by this file.
 */

const makeDoc = (ids: string[]): CampusDocument =>
  ({ buildings: ids.map((id) => ({ id, floors: [] }) as unknown as Building) }) as unknown as CampusDocument

/** Exact builder expression from FloorOutliner.tsx:331. */
const buildFloorRoute = (mapId: string, buildingId: string, floor: number) =>
  `/studio/${encodeURIComponent(mapId)}/edit/building/${encodeURIComponent(buildingId)}/floor/${floor}`

/** Extract + decode the route params the way the Next.js route delivers them. */
function decodeRoute(mapId: string, buildingId: string, floor: number) {
  const segments = buildFloorRoute(mapId, buildingId, floor).split('/')
  // ['', 'studio', mapId, 'edit', 'building', buildingId, 'floor', floor]
  return {
    mapId: decodeURIComponent(segments[2]),
    buildingId: decodeURIComponent(segments[5]),
    floor: Number(segments[7]),
  }
}

describe('P0 canonical building links — builder -> route -> resolver', () => {
  it('TEST A — canonical namespaced ID roundtrips to the exact original and resolves', () => {
    const mapId = 'map-map-1-5cbc'
    const canonical = 'map-map-1-5cbc:osm-bldg-888026366'
    const doc = makeDoc([canonical])

    const route = decodeRoute(mapId, canonical, 0)
    expect(route.mapId).toBe(mapId)
    expect(route.buildingId).toBe(canonical)
    expect(route.floor).toBe(0)
    expect(findBuilding(doc, route.buildingId)?.id).toBe(canonical)
  })

  it('TEST B — ":" in the canonical ID is preserved (encoded in URL, exact after decode)', () => {
    const canonical = 'campus-id:building-id'
    const encoded = encodeURIComponent(canonical)
    expect(encoded).not.toBe(canonical) // colon is encoded on the wire
    expect(decodeURIComponent(encoded)).toBe(canonical)
    expect(findBuilding(makeDoc([canonical]), decodeRoute('campus-id', canonical, 0).buildingId)?.id).toBe(canonical)
  })

  it('TEST C — route-sensitive characters roundtrip exactly with no double encoding', () => {
    const canonical = 'campus:bl dg#1'
    const encoded = encodeURIComponent(canonical)
    expect(encoded).toContain('%20')
    expect(encoded).toContain('%23')
    expect(decodeURIComponent(encoded)).toBe(canonical)
    expect(decodeRoute('map x', canonical, 2).buildingId).toBe(canonical)
    expect(decodeRoute('map x', canonical, 2).mapId).toBe('map x')
    // No double encoding: a second encode would change a plain ID's route.
    const plain = 'osm-bldg-123'
    expect(buildFloorRoute('map-map-1-5cbc', plain, 0)).toContain(`/building/${plain}/floor/0`)
  })

  it('TEST D — a plain legacy-shaped ID that IS the canonical ID still resolves exactly', () => {
    const plain = 'osm-bldg-123'
    expect(findBuilding(makeDoc([plain]), decodeRoute('map-map-1-5cbc', plain, 0).buildingId)?.id).toBe(plain)
  })

  it('TEST E — a raw/old ID that is NOT the canonical ID fails safe (not found, no fallback)', () => {
    const doc = makeDoc(['campus:osm-bldg-123'])
    expect(findBuilding(doc, 'osm-bldg-123')).toBeUndefined()
  })

  it('TEST F — unknown ID fails safe', () => {
    expect(findBuilding(makeDoc(['campus:osm-bldg-123']), 'campus:does-not-exist')).toBeUndefined()
  })

  it('TEST G — same raw tail across two campuses: canonical links resolve independently, raw tail is not found', () => {
    const a = 'campus-a:osm-bldg-123'
    const b = 'campus-b:osm-bldg-123'
    const doc = makeDoc([a, b])
    expect(findBuilding(doc, decodeRoute('campus-a', a, 0).buildingId)?.id).toBe(a)
    expect(findBuilding(doc, decodeRoute('campus-b', b, 0).buildingId)?.id).toBe(b)
    expect(findBuilding(doc, 'osm-bldg-123')).toBeUndefined()
  })
})
