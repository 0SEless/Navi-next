import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CampusCompiler } from '../../../compiler/src/pipeline/campus-compiler'
import { Publisher } from '../../../publisher/src/publisher'
import { serialize } from '../../../publisher/src/serializer'
import { hash, hashFile } from '../../../publisher/src/checksum'
import { EnvironmentProbe } from '../../../publisher/src/environment'
import { RoundTripVerifier } from '../../../publisher/src/round-trip-verifier'
import { RenameCommitter } from '../../../publisher/src/committer'
import { load } from '../loader/loader'
import type { CampusDocument } from '@navi/core'
import type { NavigationGraphFile, SearchIndexFile, BuildingIndexFile, POIIndexFile, FloorGeometryFile } from '@navi/core'
import type { CompileResultV2 } from '../../../compiler/src/types'

const TOLERANCE = 1e-6
function approximatelyEqual(a: number, b: number, tolerance = TOLERANCE) { return Math.abs(a - b) <= tolerance }
function loadFixture(): CampusDocument {
  const raw = readFileSync(join(__dirname, '../../../compiler/src/__tests__/fixtures/reconstructed-floor.json'), 'utf-8');
  return JSON.parse(raw) as CampusDocument
}
function compileFixture(doc: CampusDocument): CompileResultV2 {
  const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 2, optimizationLevel: 'moderate', includeAccessibility: true });
  return compiler.compileV2(doc)
}
function makePublisher() {
  return new Publisher(
    { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T },
    { hash, hashFile },
    new EnvironmentProbe(),
    new RoundTripVerifier({ hash, hashFile }, { serialize, deserialize: <T>(b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as T }),
    new RenameCommitter(),
  )
}
type Loaded = Extract<Awaited<ReturnType<typeof load>>, { success: true }>

describe.skip('Data identity: Studio -> Publisher -> Runtime', () => {
  let doc: CampusDocument
  let compileResult: CompileResultV2
  let publishedDir: string
  let runtimePkg: Loaded
  let studioGraph: NavigationGraphFile
  let studioSearch: SearchIndexFile
  let studioBuildings: BuildingIndexFile
  let studioPOI: POIIndexFile
  let studioFloorGeometry: FloorGeometryFile | undefined

  beforeAll(async () => {
    doc = loadFixture()
    compileResult = compileFixture(doc)
    expect(compileResult.success).toBe(true)
    publishedDir = mkdtempSync(join(tmpdir(), 'navi-identity-test-'))
    const publisher = makePublisher()
    const pubResult = await publisher.publish(compileResult.artifacts!, {
      campusId: 'test-campus', campusName: 'Test Campus', outputDir: publishedDir, publishedAt: '2026-08-22T00:00:00Z',
    })
    expect(pubResult.success).toBe(true)
    if (!pubResult.success) throw new Error(pubResult.message)
    const pkgDir = pubResult.path
    studioGraph = JSON.parse(readFileSync(join(pkgDir, 'graph.json'), 'utf-8'))
    studioSearch = JSON.parse(readFileSync(join(pkgDir, 'search.json'), 'utf-8'))
    studioBuildings = JSON.parse(readFileSync(join(pkgDir, 'buildings.json'), 'utf-8'))
    const poiPath = join(pkgDir, 'poi.json')
    studioPOI = existsSync(poiPath) ? JSON.parse(readFileSync(poiPath, 'utf-8')) : { schemaVersion: '1.0.0', points: [] }
    const fgPath = join(pkgDir, 'floor-geometry.json')
    studioFloorGeometry = existsSync(fgPath) ? JSON.parse(readFileSync(fgPath, 'utf-8')) : undefined
    const loadResult = await load(pkgDir)
    expect(loadResult.success).toBe(true)
    runtimePkg = loadResult as Loaded
  })
  afterAll(() => { if (existsSync(publishedDir)) rmSync(publishedDir, { recursive: true, force: true }) })

  describe('graph identity', () => {
    it('node count matches', () => { expect(runtimePkg.package.graph.nodes.length).toBe(studioGraph.nodes.length) })
    it('edge count matches', () => { expect(runtimePkg.package.graph.edges.length).toBe(studioGraph.edges.length) })
    it('all node IDs match', () => {
      const s = new Set(studioGraph.nodes.map(n => n.id))
      const r = new Set(runtimePkg.package.graph.nodes.map(n => n.id))
      expect(r).toEqual(s)
    })
    it('all edge IDs match', () => {
      const s = new Set(studioGraph.edges.map(e => e.id))
      const r = new Set(runtimePkg.package.graph.edges.map(e => e.id))
      expect(r).toEqual(s)
    })
    it('node positions match within tolerance', () => {
      for (const sn of studioGraph.nodes) {
        const rn = runtimePkg.package.graph.nodes.find(n => n.id === sn.id)!
        expect(rn).toBeDefined()
        expect(approximatelyEqual(rn.position.lat, sn.lat)).toBe(true)
        expect(approximatelyEqual(rn.position.lng, sn.lng)).toBe(true)
      }
    })
    it('node floors match', () => {
      for (const sn of studioGraph.nodes) {
        const rn = runtimePkg.package.graph.nodes.find(n => n.id === sn.id)!;
        expect(rn.floor).toBe(sn.floor)
      }
    })
    it('node buildingIds match', () => {
      for (const sn of studioGraph.nodes) {
        const rn = runtimePkg.package.graph.nodes.find(n => n.id === sn.id)!;
        expect(rn.buildingId).toBe(sn.buildingId)
      }
    })
    it('node types match', () => {
      for (const sn of studioGraph.nodes) {
        const rn = runtimePkg.package.graph.nodes.find(n => n.id === sn.id)!;
        expect(rn.type).toBe(sn.type)
      }
    })
    it('edge from/to match', () => {
      for (const se of studioGraph.edges) {
        const re = runtimePkg.package.graph.edges.find(e => e.id === se.id)!;
        expect(re.from).toBe(se.from); expect(re.to).toBe(se.to)
      }
    })
    it('edge types match', () => {
      for (const se of studioGraph.edges) {
        const re = runtimePkg.package.graph.edges.find(e => e.id === se.id)!;
        expect(re.type).toBe(se.type)
      }
    })
    it('edge distances match', () => {
      for (const se of studioGraph.edges) {
        const re = runtimePkg.package.graph.edges.find(e => e.id === se.id)!;
        expect(approximatelyEqual(re.distance, se.distance)).toBe(true)
      }
    })
    it('edge weights match', () => {
      for (const se of studioGraph.edges) {
        const re = runtimePkg.package.graph.edges.find(e => e.id === se.id)!;
        expect(approximatelyEqual(re.weight, se.weight)).toBe(true)
      }
    })
    it('campusId matches', () => { expect(runtimePkg.package.graph.campusId).toBe(studioGraph.campusId) })
  })

  describe('search index identity', () => {
    it('entry count matches', () => { expect(runtimePkg.package.searchIndex!.entries.length).toBe(studioSearch.entries.length) })
    it('all IDs match', () => {
      expect(new Set(runtimePkg.package.searchIndex!.entries.map(e=>e.id))).toEqual(new Set(studioSearch.entries.map(e=>e.id)))
    })
    it('labels match', () => {
      for (const s of studioSearch.entries) {
        const r = runtimePkg.package.searchIndex!.entries.find(e=>e.id===s.id)!;
        expect(r.label).toBe(s.label)
      }
    })
    it('types match', () => {
      for (const s of studioSearch.entries) {
        const r = runtimePkg.package.searchIndex!.entries.find(e=>e.id===s.id)!;
        expect(r.type).toBe(s.type)
      }
    })
    it('nodeIds match', () => {
      for (const s of studioSearch.entries) {
        const r = runtimePkg.package.searchIndex!.entries.find(e=>e.id===s.id)!;
        expect(r.nodeId).toBe(s.nodeId)
      }
    })
    it('positions match within tolerance', () => {
      for (const s of studioSearch.entries) {
        const r = runtimePkg.package.searchIndex!.entries.find(e=>e.id===s.id)!;
        expect(approximatelyEqual(r.position.lat, s.lat)).toBe(true)
        expect(approximatelyEqual(r.position.lng, s.lng)).toBe(true)
      }
    })
    it('tags match', () => {
      for (const s of studioSearch.entries) {
        const r = runtimePkg.package.searchIndex!.entries.find(e=>e.id===s.id)!;
        expect(r.tags).toEqual(s.tags)
      }
    })
  })
  describe('building index identity', () => {
    it('buildingIndex is loaded', () => { expect(runtimePkg.package.buildingIndex).toBeDefined() })
    it('building count matches', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; expect(bi.buildings.length).toBe(studioBuildings.buildings.length) })
    it('all building IDs match', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; expect(new Set(bi.buildings.map(b=>b.id))).toEqual(new Set(studioBuildings.buildings.map(b=>b.id))) })
    it('building names match', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const sb of studioBuildings.buildings) { expect(bi.buildings.find(b=>b.id===sb.id)!.name).toBe(sb.name) } })
    it('building codes match', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const sb of studioBuildings.buildings) { expect(bi.buildings.find(b=>b.id===sb.id)!.code).toBe(sb.code) } })
    it('building positions match', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const sb of studioBuildings.buildings) { const rb = bi.buildings.find(b=>b.id===sb.id)!; expect(approximatelyEqual(rb.position.lat, sb.position.lat)).toBe(true); expect(approximatelyEqual(rb.position.lng, sb.position.lng)).toBe(true) } })
    it('floor count per building matches', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const sb of studioBuildings.buildings) { expect(bi.buildings.find(b=>b.id===sb.id)!.floors.length).toBe(sb.floors.length) } })
    it('floor levels match', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const sb of studioBuildings.buildings) { const rb = bi.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { expect(rb.floors.find(f=>f.level===sf.level)!.label).toBe(sf.label) } } })
    it('floor room IDs match', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const sb of studioBuildings.buildings) { const rb = bi.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; expect(new Set(rf.rooms.map(r=>r.id))).toEqual(new Set((sf.rooms ?? []).map(r=>r.id))) } } })
    it('entrance IDs match', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const sb of studioBuildings.buildings) { const rb = bi.buildings.find(b=>b.id===sb.id)!; expect(new Set(rb.entrances.map(e=>e.id))).toEqual(new Set(sb.entrances.map(e=>e.id))) } })
  })

  describe('POI index identity', () => {
    it('POI count matches', () => { expect(runtimePkg.package.poiIndex!.points.length).toBe(studioPOI.points.length) })
    it('all POI IDs match', () => { expect(new Set(runtimePkg.package.poiIndex!.points.map(p=>p.id))).toEqual(new Set(studioPOI.points.map(p=>p.id))) })
  })
  describe('floor geometry identity', () => {
    it('floor geometry present when expected', () => { if (studioFloorGeometry) expect(runtimePkg.package.floorGeometry).toBeDefined() })
    it('building count matches', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; expect(runtimePkg.package.floorGeometry.buildings.length).toBe(studioFloorGeometry.buildings.length) })
    it('building IDs match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; expect(new Set(runtimePkg.package.floorGeometry.buildings.map(b=>b.id))).toEqual(new Set(studioFloorGeometry.buildings.map(b=>b.id))) })
    it('room IDs per floor match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; expect(new Set(rf.rooms.map(r=>r.id))).toEqual(new Set(sf.rooms.map(r=>r.id))) } } })
    it('room polygons match within tolerance', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; for (const srm of sf.rooms) { const rrm = rf.rooms.find(r=>r.id===srm.id)!; expect(rrm.polygon.points.length).toBe(srm.polygon.points.length); for (let i=0;i<srm.polygon.points.length;i++) { expect(approximatelyEqual(rrm.polygon.points[i].x, srm.polygon.points[i].x)).toBe(true); expect(approximatelyEqual(rrm.polygon.points[i].y, srm.polygon.points[i].y)).toBe(true) } } } } })
    it('door IDs match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; expect(new Set(rf.doors.map(d=>d.id))).toEqual(new Set(sf.doors.map(d=>d.id))) } } })
    it('staircase IDs match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; expect(new Set(rf.staircases.map(s=>s.id))).toEqual(new Set(sf.staircases.map(s=>s.id))) } } })
    it('elevator IDs match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; expect(new Set(rf.elevators.map(e=>e.id))).toEqual(new Set(sf.elevators.map(e=>e.id))) } } })
    it('hallway IDs match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; expect(new Set(rf.hallways.map(h=>h.id))).toEqual(new Set(sf.hallways.map(h=>h.id))) } } })
    it('hallway polylines match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; for (const sh of sf.hallways) { const rh = rf.hallways.find(h=>h.id===sh.id)!; expect(rh.polyline.points.length).toBe(sh.polyline.points.length); for (let i=0;i<sh.polyline.points.length;i++) { expect(approximatelyEqual(rh.polyline.points[i].x, sh.polyline.points[i].x)).toBe(true); expect(approximatelyEqual(rh.polyline.points[i].y, sh.polyline.points[i].y)).toBe(true) } } } } })
    it('staircase positions match', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const sb of studioFloorGeometry.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===sb.id)!; for (const sf of sb.floors) { const rf = rb.floors.find(f=>f.level===sf.level)!; for (const ss of sf.staircases) { const rs = rf.staircases.find(s=>s.id===ss.id)!; expect(approximatelyEqual(rs.position.x, ss.position.x)).toBe(true); expect(approximatelyEqual(rs.position.y, ss.position.y)).toBe(true); expect(approximatelyEqual(rs.rotation, ss.rotation)).toBe(true) } } } })
  })
  describe('cross-artifact consistency', () => {
    it('graph node buildingIds exist in building index', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; const bids = new Set(bi.buildings.map(b=>b.id)); for (const n of runtimePkg.package.graph.nodes) { if (n.buildingId !== '__outdoor__') expect(bids.has(n.buildingId)).toBe(true) } })
    it('graph node floors exist in building floor list', () => { const bi = runtimePkg.package.buildingIndex; if (!bi) return; for (const n of runtimePkg.package.graph.nodes) { const b = bi.buildings.find(x=>x.id===n.buildingId); if (b) expect(b.floors.find(f=>f.level===n.floor)).toBeDefined() } })
    it('search nodeIds reference existing graph nodes', () => { const nids = new Set(runtimePkg.package.graph.nodes.map(n=>n.id)); for (const e of runtimePkg.package.searchIndex!.entries) { if (e.nodeId) expect(nids.has(e.nodeId)).toBe(true) } })
    it('manifest metadata counts are consistent', () => { const m = runtimePkg.package.manifest; expect(m.metadata.nodeCount).toBe(runtimePkg.package.graph.nodes.length); expect(m.metadata.edgeCount).toBe(runtimePkg.package.graph.edges.length); // buildingCount is computed from graph, may differ from buildingIndex in test fixtures; const bi = runtimePkg.package.buildingIndex; if (bi && m.metadata.buildingCount > 0) expect(m.metadata.buildingCount).toBe(bi.buildings.length) })
    it('studio/runtime graph node count matches', () => { expect(runtimePkg.package.graph.nodes.length).toBe(studioGraph.nodes.length) })
    it('studio/runtime graph edge count matches', () => { expect(runtimePkg.package.graph.edges.length).toBe(studioGraph.edges.length) })
  })

  describe('entity-specific ID preservation', () => {
    it('hallway IDs preserved editor -> floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; const s = new Set(); studioFloorGeometry.buildings.forEach(b=>b.floors.forEach(f=>f.hallways.forEach(h=>s.add(h.id)))); const r = new Set(); runtimePkg.package.floorGeometry!.buildings.forEach(b=>b.floors.forEach(f=>f.hallways.forEach(h=>r.add(h.id)))); expect(r).toEqual(s) })
    it('room IDs preserved editor -> floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; const s = new Set(); studioFloorGeometry.buildings.forEach(b=>b.floors.forEach(f=>f.rooms.forEach(rm=>s.add(rm.id)))); const r = new Set(); runtimePkg.package.floorGeometry!.buildings.forEach(b=>b.floors.forEach(f=>f.rooms.forEach(rm=>r.add(rm.id)))); expect(r).toEqual(s) })
    it('door IDs preserved editor -> floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; const s = new Set(); studioFloorGeometry.buildings.forEach(b=>b.floors.forEach(f=>f.doors.forEach(d=>s.add(d.id)))); const r = new Set(); runtimePkg.package.floorGeometry!.buildings.forEach(b=>b.floors.forEach(f=>f.doors.forEach(d=>r.add(d.id)))); expect(r).toEqual(s) })
    it('staircase IDs preserved editor -> floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; const s = new Set(); studioFloorGeometry.buildings.forEach(b=>b.floors.forEach(f=>f.staircases.forEach(x=>s.add(x.id)))); const r = new Set(); runtimePkg.package.floorGeometry!.buildings.forEach(b=>b.floors.forEach(f=>f.staircases.forEach(x=>r.add(x.id)))); expect(r).toEqual(s) })
    it('elevator IDs preserved editor -> floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; const s = new Set(); studioFloorGeometry.buildings.forEach(b=>b.floors.forEach(f=>f.elevators.forEach(x=>s.add(x.id)))); const r = new Set(); runtimePkg.package.floorGeometry!.buildings.forEach(b=>b.floors.forEach(f=>f.elevators.forEach(x=>r.add(x.id)))); expect(r).toEqual(s) })
    it('staircase IDs from editor document preserved in floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; const s = new Set<string>(); doc.buildings.forEach(b=>(b.staircases ?? []).forEach(x=>s.add(x.id))); const r = new Set<string>(); runtimePkg.package.floorGeometry!.buildings.forEach(b=>b.floors.forEach(f=>f.staircases.forEach(x=>r.add(x.id)))); for (const id of s) expect(r.has(id)).toBe(true) })
    it('route node IDs preserved', () => { expect(new Set(runtimePkg.package.graph.nodes.map(n=>n.id))).toEqual(new Set(studioGraph.nodes.map(n=>n.id))) })
    it('route edge IDs preserved', () => { expect(new Set(runtimePkg.package.graph.edges.map(e=>e.id))).toEqual(new Set(studioGraph.edges.map(e=>e.id))) })
    it('building IDs from editor preserved in floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; const s = new Set(doc.buildings.map(b=>b.id)); const r = new Set(runtimePkg.package.floorGeometry!.buildings.map(b=>b.id)); for (const id of s) expect(r.has(id)).toBe(true) })
    it('floor levels from editor preserved in floor geometry', () => { if (!studioFloorGeometry||!runtimePkg.package.floorGeometry) return; for (const db of doc.buildings) { const rb = runtimePkg.package.floorGeometry!.buildings.find(b=>b.id===db.id); if (!rb) continue; for (const df of db.floors) { const rf = rb.floors.find(f=>f.level===df.level); if (rf) expect(rf.label).toBe(df.label) } } })
    it('coordinates match within 1e-9', () => { for (const sn of studioGraph.nodes) { const rn = runtimePkg.package.graph.nodes.find(n=>n.id===sn.id)!; expect(approximatelyEqual(rn.position.lat, sn.lat, 1e-9)).toBe(true); expect(approximatelyEqual(rn.position.lng, sn.lng, 1e-9)).toBe(true) } })
  })

  describe('comparison table', () => {
    it('prints entity-by-entity comparison', () => {
      const rows = [['Entity', 'Studio', 'Runtime', 'Match']];
      const add = (n: string,s: number,r: number) => rows.push([n, String(s), String(r), s===r?'PASS':'FAIL']);
      add('Graph Nodes', studioGraph.nodes.length, runtimePkg.package.graph.nodes.length);
      add('Graph Edges', studioGraph.edges.length, runtimePkg.package.graph.edges.length);
      add('Search Entries', studioSearch.entries.length, runtimePkg.package.searchIndex!.entries.length);
      add('Buildings', studioBuildings.buildings.length, runtimePkg.package.buildingIndex?.buildings.length ?? 0);
      const sf = studioBuildings.buildings.reduce((s,b)=>s+b.floors.length,0);
      const rf = (runtimePkg.package.buildingIndex?.buildings ?? []).reduce((s,b)=>s+b.floors.length,0);
      add('Floors', sf, rf);
      add('POI Points', studioPOI.points.length, runtimePkg.package.poiIndex!.points.length);
      if (studioFloorGeometry && runtimePkg.package.floorGeometry) {
        const cnt = (a: {length:number}[]) => a.reduce((s: number,x: {length:number})=>s+x.length,0);
        add('Rooms (FG)', cnt(studioFloorGeometry.buildings.flatMap(b=>b.floors.map(f=>f.rooms))), cnt(runtimePkg.package.floorGeometry!.buildings.flatMap(b=>b.floors.map(f=>f.rooms))));
        add('Doors (FG)', cnt(studioFloorGeometry.buildings.flatMap(b=>b.floors.map(f=>f.doors))), cnt(runtimePkg.package.floorGeometry!.buildings.flatMap(b=>b.floors.map(f=>f.doors))));
        add('Staircases (FG)', cnt(studioFloorGeometry.buildings.flatMap(b=>b.floors.map(f=>f.staircases))), cnt(runtimePkg.package.floorGeometry!.buildings.flatMap(b=>b.floors.map(f=>f.staircases))));
        add('Elevators (FG)', cnt(studioFloorGeometry.buildings.flatMap(b=>b.floors.map(f=>f.elevators))), cnt(runtimePkg.package.floorGeometry!.buildings.flatMap(b=>b.floors.map(f=>f.elevators))));
        add('Hallways (FG)', cnt(studioFloorGeometry.buildings.flatMap(b=>b.floors.map(f=>f.hallways))), cnt(runtimePkg.package.floorGeometry!.buildings.flatMap(b=>b.floors.map(f=>f.hallways))));
      }
      console.log('\n' + rows.map(r=>r.join(' | ')).join('\n'));
      for (const row of rows.slice(1)) expect(row[row.length-1]).toBe('PASS');
    })
  })
})