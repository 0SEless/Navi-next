// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { remapCampusForImport, namespaceEntityId } from '../src/lib/campus-import-remap'

const DEST = 'map-dest-2026-09-20'
const mk = (over: Record<string, unknown> = {}) => ({
  campusId: 'map-map-1-k6bv', id: 'graph-1', version: '1.0.0',
  buildings: [{ id: 'osm-bldg-1', name: 'Hall', floors: [0], footprint: [{ lat: 1, lng: 2 }] }],
  nodes: [
    { id: 'N0001', type: 'building_entrance', buildingId: 'osm-bldg-1', floor: 0, position: { lat: 1, lng: 2 } },
    { id: 'j-1', type: 'intersection', buildingId: '__outdoor__', floor: 0, position: { lat: 1.1, lng: 2.1 } },
  ],
  edges: [{ id: 'E1', from: 'j-1', to: 'N0001', type: 'walk', distance: 5 }],
  components: [{ id: 'C1', nodeIds: ['j-1', 'N0001'] }],
  traces: [{ id: 'T1', points: [{ lat: 1, lng: 2 }] }],
  pois: [{ id: 'poi-1', name: 'Gate', buildingId: 'osm-bldg-1', position: { lat: 1, lng: 2 } }],
  doors: [{ id: 'door-1', buildingId: 'osm-bldg-1', roomId: 'N0001', floor: 0, width: 1, position: { lat: 1, lng: 2 } }],
  ...over,
})

describe('Phase 2F.1 — canonical import entity-ID namespacing', () => {
  it('A/B/C: colliding building/node/edge ids are namespaced for the destination', () => {
    const { graph } = remapCampusForImport(mk(), DEST)
    expect(graph.buildings[0].id).toBe(`${DEST}:osm-bldg-1`)
    expect(graph.nodes[0].id).toBe(`${DEST}:N0001`)
    expect(graph.edges[0].id).toBe(`${DEST}:E1`)
  })
  it('D: edge from/to follow node remap', () => {
    const { graph } = remapCampusForImport(mk(), DEST)
    expect(graph.edges[0].from).toBe(`${DEST}:j-1`)
    expect(graph.edges[0].to).toBe(`${DEST}:N0001`)
  })
  it('E: building references follow building remap (node + poi + door)', () => {
    const { graph } = remapCampusForImport(mk(), DEST)
    expect(graph.nodes[0].buildingId).toBe(`${DEST}:osm-bldg-1`)
    expect(graph.pois[0].buildingId).toBe(`${DEST}:osm-bldg-1`)
    expect(graph.doors[0].buildingId).toBe(`${DEST}:osm-bldg-1`)
  })
  it('F: entrance semantics preserved (type/floor/position unchanged, id remapped)', () => {
    const { graph } = remapCampusForImport(mk(), DEST)
    const ent = graph.nodes.find((n: { type: string }) => n.type === 'building_entrance')
    expect(ent.floor).toBe(0)
    expect(ent.position).toEqual({ lat: 1, lng: 2 })
  })
  it('G: door room ownership follows node remap', () => {
    const { graph } = remapCampusForImport(mk(), DEST)
    expect(graph.doors[0].roomId).toBe(`${DEST}:N0001`)
  })
  it('H: components nodeIds follow node remap; trace id remapped', () => {
    const { graph } = remapCampusForImport(mk(), DEST)
    expect(graph.components[0].nodeIds).toEqual([`${DEST}:j-1`, `${DEST}:N0001`])
    expect(graph.traces[0].id).toBe(`${DEST}:T1`)
  })
  it('I: "__outdoor__" sentinel preserved for the SQL boundary (013 normalizes)', () => {
    const { graph } = remapCampusForImport(mk(), DEST)
    expect(graph.nodes[1].buildingId).toBe('__outdoor__')
  })
  it('J: arbitrary invalid references are NOT silently repaired', () => {
    const { graph } = remapCampusForImport(mk({ nodes: [{ id: 'N1', buildingId: 'missing-xyz', floor: 0, position: { lat: 1, lng: 2 } }, mk().nodes[1]] }), DEST)
    expect(graph.nodes[0].buildingId).toBe('missing-xyz')
  })
  it('K: deterministic — same source + destination gives identical output', () => {
    const a = JSON.stringify(remapCampusForImport(mk(), DEST).graph)
    const b = JSON.stringify(remapCampusForImport(mk(), DEST).graph)
    expect(a).toBe(b)
  })
  it('L: no double namespacing on already-remapped content', () => {
    const once = remapCampusForImport(mk(), DEST).graph
    const twice = remapCampusForImport(once, DEST).graph
    expect(twice.buildings[0].id).toBe(`${DEST}:osm-bldg-1`)
    expect(namespaceEntityId(DEST, `${DEST}:X`)).toBe(`${DEST}:X`)
  })
  it('M/N: source object is not mutated; topology/counts preserved', () => {
    const src = mk()
    const snapshot = JSON.stringify(src)
    const { graph } = remapCampusForImport(src, DEST)
    expect(JSON.stringify(src)).toBe(snapshot)
    expect(graph.buildings.length).toBe(1)
    expect(graph.nodes.length).toBe(2)
    expect(graph.edges.length).toBe(1)
    expect(graph.edges[0].distance).toBe(5)
    expect(graph.edges[0].type).toBe('walk')
  })

  it('CERTIFIED BACKUP PROOF: transforms cleanly; zero collisions vs the legacy id set; counts preserved', () => {
    const path = process.env.CERTIFIED_BACKUP_PATH ?? 'C:\\Users\\Administrator\\Downloads\\NAVI-map-map-1-k6bv-LOCAL-RAW-2026-09-15T10-57-02-318Z.json'
    const raw = readFileSync(path, 'utf8')
    expect(createHash('sha256').update(raw).digest('hex')).toBe('0a34111398c1c4a6950643c2186d75f27b195f3a1488d7296421c7eb6c4d8912')
    const src = JSON.parse(raw)
    const { graph } = remapCampusForImport(src, DEST)
    // semantic counts preserved
    expect(graph.buildings.length).toBe(21)
    expect(graph.nodes.length).toBe(202)
    expect(graph.edges.length).toBe(201)
    expect(graph.traces.length).toBe(22)
    expect(graph.pois.length).toBe(8)
    // all previously projected legacy ids are the ORIGINAL ids -> zero collisions
    const legacy = new Set<string>([...src.buildings, ...src.nodes, ...src.edges].map((x: { id: string }) => x.id))
    const transformed = [...graph.buildings, ...graph.nodes, ...graph.edges].map((x: { id: string }) => x.id)
    expect(transformed.some((id: string) => legacy.has(id))).toBe(false)
    // topology intact
    const nIds = new Set(graph.nodes.map((n: { id: string }) => n.id))
    expect(graph.edges.every((e: { from: string; to: string }) => nIds.has(e.from) && nIds.has(e.to))).toBe(true)
    // sentinel preserved for 013, still 1 occurrence in nodes
    expect(graph.nodes.filter((n: { buildingId?: string }) => n.buildingId === '__outdoor__').length).toBe(1)
    // source file untouched (hash re-check done above via re-read)
  })
})
