import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DEMO = join(__dirname, 'demo-output')

let passCount = 0
let failCount = 0
const failures = []

function check(label, ok, detail) {
  process.stdout.write(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` (${detail})` : ''}\n`)
  if (ok) passCount++
  else { failCount++; failures.push(label) }
}

function heading(s) {
  process.stdout.write(`\n  \u2500\u2500 ${s} \u2500\u2500\n`)
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  const BASE = 'http://localhost:3000'
  const mapId = 'uat-campus'

  // Seed campus + building data before navigation (one-time: only if not already saved)
  const now = new Date().toISOString()
  await ctx.addInitScript((args) => {
    const { mapId, now } = args
    // Campus map (always needed)
    localStorage.setItem('navi-campus-maps', JSON.stringify({
      maps: [{
        id: mapId, name: 'UAT Campus', schoolName: 'Test University',
        boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
        center: { lat: 11.001, lng: 125.002 },
        createdAt: now, updatedAt: now,
        stats: { buildings: 1, nodes: 0, edges: 0 },
      }],
      landmarkTypes: [],
      landmarkInstances: [],
    }))
    // Graph with one building — only if not already saved (survives reload)
    if (!localStorage.getItem('navi-graph-' + mapId)) {
      localStorage.setItem('navi-graph-' + mapId, JSON.stringify({
        id: mapId, campusId: mapId, name: 'UAT Campus',
        version: '1.0.0', updatedAt: now,
        buildings: [{
          id: 'bld-1', name: 'Main Building', code: 'MB',
          color: '#8B5CF6', height: 20,
          floors: [{ id: 'flr-0', level: 0, label: 'Ground Floor', elevation: 0 }],
          footprint: [
            { lat: 11.0009, lng: 125.0016 },
            { lat: 11.0012, lng: 125.0016 },
            { lat: 11.0012, lng: 125.0020 },
            { lat: 11.0009, lng: 125.0020 },
          ],
        }],
        nodes: [], edges: [], components: [], traces: [],
      }))
    }
  }, { mapId, now })

  console.log('\n' + '='.repeat(70))
  console.log('  GATE 5 \u2014 USER ACCEPTANCE TEST (Phases 3\u20136)')
  console.log('='.repeat(70))

  // ===================================================================
  // PHASE 3 — FLOOR ENTITIES
  // ===================================================================
  console.log('\n  PHASE 3 \u2014 FLOOR ENTITIES\n')

  // Navigate to editor
  heading('Open Editor')
  await page.goto(`${BASE}/studio/${mapId}/edit`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(3000)

  let editorReady = false
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => !!document.querySelector('[data-editor-ready]'))
    if (ready) { editorReady = true; break }
    await page.waitForTimeout(500)
  }
  check('Editor context initialized', editorReady)

  // CRUD Note: The editor dispatcher methods require specific service access patterns
  // The context services are accessed via services.get('id') or services[id]

  // 3a. Create Room
  heading('Create Room')
  const roomResult = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      if (!svc) return 'no-context'
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const dispatcher = get('dispatcher')
      const ds = get('documentStore')
      if (!ds || !dispatcher) return 'no-services'
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const b = doc.buildings?.[0]
      const f = b?.floors?.[0]
      if (!b || !f) return 'no-building-or-floor'
      const id = 'room-' + Date.now()
      dispatcher.execute({
        id: 'room.create', label: 'Create Room',
        payload: {
          id, buildingId: b.id, floorId: f.id, name: 'Room 101', number: '101',
          points: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }],
        },
      })
      return 'ok:' + id
    } catch (e) { return String(e) }
  })
  check('Room created via dispatcher', roomResult.startsWith('ok'), roomResult)

  // 3b. Create Hallway
  heading('Create Hallway')
  const hallwayResult = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const dispatcher = get('dispatcher')
      const ds = get('documentStore')
      if (!ds || !dispatcher) return 'no-services'
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const b = doc.buildings?.[0]
      const f = b?.floors?.[0]
      if (!b || !f) return 'no-building-or-floor'
      dispatcher.execute({
        id: 'hallway.create', label: 'Create Hallway',
        payload: { buildingId: b.id, floorId: f.id, name: 'Main Hallway', points: [{ x: -10, y: 0 }, { x: 10, y: 0 }], width: 3 },
      })
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Hallway created via dispatcher', hallwayResult === 'ok', hallwayResult)

  // 3c. Create Entrance
  heading('Create Entrance')
  const entranceResult = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const dispatcher = get('dispatcher')
      const ds = get('documentStore')
      if (!ds || !dispatcher) return 'no-services'
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const b = doc.buildings?.[0]
      const f = b?.floors?.[0]
      if (!b || !f) return 'no-building-or-floor'
      const fp = b.footprint?.points?.length > 0 ? b.footprint.points : b.footprint || []
      const lat = fp.reduce((s, p) => s + (typeof p.lat === 'number' ? p.lat : p.lat || 0), 0) / Math.max(fp.length, 1)
      const lng = fp.reduce((s, p) => s + (typeof p.lng === 'number' ? p.lng : p.lng || 0), 0) / Math.max(fp.length, 1)
      dispatcher.execute({
        id: 'entrance.create', label: 'Create Entrance',
        payload: { buildingId: b.id, floorId: f.id, label: 'Main Entrance', position: { lat: lat || 11.001, lng: lng || 125.002 }, type: 'main' },
      })
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Entrance created via dispatcher', entranceResult === 'ok', entranceResult)

  await page.waitForTimeout(500)

  // 3d. Read back entities to verify creation
  heading('Verify Entity Creation')
  const entityCounts = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ds = get('documentStore')
      if (!ds) return null
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const f = doc.buildings?.[0]?.floors?.[0]
      if (!f) return null
      return {
        rooms: f.rooms?.length || 0,
        hallways: f.hallways?.length || 0,
        entrances: f.entrances?.length || 0,
      }
    } catch { return null }
  })
  check('Room exists', entityCounts && entityCounts.rooms >= 1, entityCounts ? `${entityCounts.rooms} room(s)` : 'null')
  check('Hallway exists', entityCounts && entityCounts.hallways >= 1, entityCounts ? `${entityCounts.hallways} hallway(s)` : 'null')
  check('Entrance exists', entityCounts && entityCounts.entrances >= 1, entityCounts ? `${entityCounts.entrances} entrance(s)` : 'null')

  // 3e. Rename Room (Update)
  heading('Edit Entity Properties')
  const roomNameBefore = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ds = get('documentStore')
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      return doc.buildings?.[0]?.floors?.[0]?.rooms?.[0]?.name || ''
    } catch { return '' }
  })

  const editResult = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const dispatcher = get('dispatcher')
      const ds = get('documentStore')
      if (!ds || !dispatcher) return 'no-services'
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const room = doc.buildings?.[0]?.floors?.[0]?.rooms?.[0]
      if (!room) return 'no-room'
      dispatcher.execute({
        id: 'entity.update', label: 'Rename Room',
        payload: { entityId: room.id, changes: { name: 'Faculty Office' } },
      })
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Room renamed via dispatcher', editResult === 'ok', editResult)

  const roomNameAfter = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ds = get('documentStore')
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      return doc.buildings?.[0]?.floors?.[0]?.rooms?.[0]?.name || ''
    } catch { return '' }
  })
  check('Room name changed', roomNameAfter === 'Faculty Office', `${roomNameBefore} \u2192 ${roomNameAfter}`)

  // 3f. Undo / Redo
  heading('Undo / Redo')
  const undone = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const history = get('history')
      if (!history) return 'no-history'
      history.undo()
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Undo performed', undone === 'ok', undone)

  await page.waitForTimeout(300)
  const nameAfterUndo = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ds = get('documentStore')
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      return doc.buildings?.[0]?.floors?.[0]?.rooms?.[0]?.name || ''
    } catch { return '' }
  })
  check('Room name reverted by undo', nameAfterUndo !== 'Faculty Office', nameAfterUndo)

  const redone = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const history = get('history')
      if (!history) return 'no-history'
      history.redo()
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Redo performed', redone === 'ok', redone)

  await page.waitForTimeout(300)
  const nameAfterRedo = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ds = get('documentStore')
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      return doc.buildings?.[0]?.floors?.[0]?.rooms?.[0]?.name || ''
    } catch { return '' }
  })
  check('Room name restored by redo', nameAfterRedo === 'Faculty Office', nameAfterRedo)

  // 3g. Save & Reload
  heading('Save & Reload')

  // Wait for async service init to complete (registry.init() is fire-and-forget)
  await page.waitForTimeout(1500)

  // Save via workflow service so save state is tracked (NOT __naviSave which bypasses WorkflowStore)
  const saveResult = await page.evaluate(async () => {
    try {
      const wf = window.__naviContext?.get?.('workflow')
      if (!wf || typeof wf.save !== 'function') return 'no-workflow-service'
      await wf.save('manual')
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Save executed', saveResult === 'ok', saveResult)
  await page.waitForTimeout(1000)

  // Check localStorage after save
  const lsAfter = await page.evaluate((id) => {
    const raw = localStorage.getItem('navi-graph-' + id)
    if (!raw) return { exists: false }
    try {
      const d = JSON.parse(raw)
      return {
        exists: true, components: d.components?.length || 0, nodes: d.nodes?.length || 0,
        compTypes: (d.components || []).map(c => c.type),
        nodeCount: d.nodes?.length || 0,
        bldgRooms: d.buildings?.[0]?.floors?.[0]?.rooms?.length || 'legacy-n/a',
      }
    } catch { return { exists: false, parseError: true } }
  }, mapId)
  check('After save: components in localStorage', lsAfter.components > 0,
    `${lsAfter.components} comps (${(lsAfter.compTypes || []).join(',')}), ${lsAfter.nodes} nodes`)

  const editorUrl = page.url()
  await page.goto(editorUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(5000)

  let reloadReady = false
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => !!document.querySelector('[data-editor-ready]'))
    if (ready) { reloadReady = true; break }
    await page.waitForTimeout(500)
  }
  check('Editor re-initialized', reloadReady)

  // Debug: check localStorage directly from reloaded page
  const localStorageReloaded = await page.evaluate((id) => {
    const raw = localStorage.getItem('navi-graph-' + id)
    if (!raw) return 'no-data'
    try {
      const data = JSON.parse(raw)
      return {
        components: data.components?.length || 0,
        nodes: data.nodes?.length || 0,
        buildings: data.buildings?.length || 0,
        buildingFloors: data.buildings?.[0]?.floors?.length || 0,
        hasComponents: data.components?.length > 0,
        componentIds: (data.components || []).map(c => c.id).join(','),
      }
    } catch { return 'parse-error' }
  }, mapId)
  check('LocalStorage has components after reload', localStorageReloaded && localStorageReloaded.hasComponents,
    typeof localStorageReloaded === 'object' ? `${localStorageReloaded.components} components: ${localStorageReloaded.componentIds || ''}` : String(localStorageReloaded))

  const persisted = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ds = get('documentStore')
      if (!ds) return null
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const f = doc.buildings?.[0]?.floors?.[0]
      if (!f) return null
      return {
        rooms: f.rooms?.length || 0,
        hallways: f.hallways?.length || 0,
        entrances: f.entrances?.length || 0,
        roomName: f.rooms?.[0]?.name || '',
      }
    } catch { return null }
  })
  check('Rooms persisted in document', persisted && persisted.rooms >= 1, persisted ? String(persisted.rooms) : 'null')
  check('Hallways persisted in document', persisted && persisted.hallways >= 1, persisted ? String(persisted.hallways) : 'null')
  check('Entrances persisted in document', persisted && persisted.entrances >= 1, persisted ? String(persisted.entrances) : 'null')
  check('Room name persisted', persisted && persisted.roomName === 'Faculty Office', persisted ? persisted.roomName : '')

  // ===================================================================
  // PHASE 4 — VALIDATION
  // ===================================================================
  console.log('\n  PHASE 4 \u2014 VALIDATION\n')

  heading('Validate Document')
  const validationResult = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ve = get('validationEngine')
      const ds = get('documentStore')
      if (!ve || !ds) return 'no-services'
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const snap = ve.validate(doc)
      return {
        total: snap.statistics.totalIssues,
        errors: snap.statistics.errors,
        warnings: snap.statistics.warnings,
        state: snap.state,
        issueCount: snap.issues.length,
        fixableCount: snap.issues.filter(i => i.fixId).length,
      }
    } catch (e) { return { error: String(e) } }
  })
  check('Validation engine accessible', !!(validationResult && !validationResult.error),
    validationResult && !validationResult.error ? `${validationResult.total} issues (${validationResult.errors} errors, ${validationResult.warnings} warnings), ${validationResult.fixableCount} fixable` : JSON.stringify(validationResult))

  // Apply auto-fix on the first fixable issue
  heading('Auto-Fix')
  const fixResult = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ve = get('validationEngine')
      const afr = get('autoFixRegistry')
      const ds = get('documentStore')
      if (!ve || !afr || !ds) return 'no-services'
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const snap = ve.validate(doc)
      const fixable = snap.issues.filter(i => i.fixId)
      if (fixable.length === 0) return 'no-fixable-issues'
      const applied = afr.applyFix(fixable[0])
      return applied ? 'applied:' + fixable[0].fixId : 'apply-failed'
    } catch (e) { return String(e) }
  })
  check('Auto-fix applied', fixResult.startsWith('applied'), fixResult)
  await page.waitForTimeout(300)

  // Re-validate
  heading('Re-validate')
  const revalidated = await page.evaluate(() => {
    try {
      const svc = window.__naviContext
      const get = (id) => (typeof svc.get === 'function' ? svc.get(id) : null)
      const ve = get('validationEngine')
      const ds = get('documentStore')
      if (!ve || !ds) return 'no-services'
      const doc = typeof ds.getDocument === 'function' ? ds.getDocument() : ds.document
      const snap = ve.validate(doc)
      return { total: snap.statistics.totalIssues }
    } catch (e) { return { error: String(e) } }
  })
  check('Re-validation completed', !!(revalidated && !revalidated.error),
    revalidated && !revalidated.error ? `${revalidated.total} remaining` : JSON.stringify(revalidated))

  // ===================================================================
  // PHASE 5 — PUBLISH
  // ===================================================================
  console.log('\n  PHASE 5 \u2014 PUBLISH\n')

  heading('Publish')

  // Save via workflow so publish's hasUnsavedChanges() check passes
  await page.evaluate(async () => {
    try {
      const wf = window.__naviContext?.get?.('workflow')
      if (wf && typeof wf.save === 'function') await wf.save('manual')
    } catch {}
  })
  await page.waitForTimeout(1500)

  // Find and click Publish button in the toolbar
  const publishBtn = page.locator('button', { hasText: 'Publish' })
  const publishCount = await publishBtn.count()
  check('Publish button visible', publishCount > 0, `${publishCount} found`)

  let dialogVisible = false
  if (publishCount > 0) {
    await publishBtn.first().click()
    await page.waitForTimeout(3000)

    // Handle "Publish Anyway" if validation errors
    const publishAnyway = page.locator('button', { hasText: 'Publish Anyway' })
    if (await publishAnyway.count() > 0) {
      process.stdout.write('    Validation errors detected \u2014 clicking Publish Anyway\n')
      await publishAnyway.first().click()
      check('Publish Anyway clicked', true)
      // Wait for publish compilation + upload + UI update
      await page.waitForTimeout(5000)
    } else {
      await page.waitForTimeout(3000)
    }

    const successDialog = page.locator('h2', { hasText: 'Publish Successful' })
    await successDialog.waitFor({ state: 'visible', timeout: 10000 }).then(() => {
      dialogVisible = true
    }).catch(() => {
      dialogVisible = false
    })
    check('Publish success dialog', dialogVisible)

    if (dialogVisible) {
      const content = await page.evaluate(() => {
        const modal = document.querySelector('.fixed.inset-0.z-50')
        if (!modal) return null
        const text = modal.textContent || ''
        return {
          hasRevision: text.includes('Revision'),
          hasNodes: text.includes('Nodes'),
          hasEdges: text.includes('Edges'),
          hasArtifacts: text.includes('Artifacts'),
          hasLocation: text.includes('demo-output'),
        }
      })
      check('Revision shown', content && content.hasRevision)
      check('Node count shown', content && content.hasNodes)
      check('Edge count shown', content && content.hasEdges)
      check('Artifact count shown', content && content.hasArtifacts)
      check('Location shown', content && content.hasLocation)

      const closeBtn = page.locator('button', { hasText: 'Close' })
      if (await closeBtn.count() > 0) await closeBtn.first().click()
      await page.waitForTimeout(500)
    }
  }

  // Verify artifacts on disk
  heading('Published Artifacts')
  const artifactFiles = ['manifest.json', 'navigation.graph.json', 'search.index.json', 'poi.json', 'building-index.json']
  const artifactResults = {}
  for (const f of artifactFiles) {
    const e = existsSync(join(DEMO, f))
    artifactResults[f] = e
    check(`Artifact: ${f}`, e)
  }

  // ===================================================================
  // PHASE 6 — RUNTIME (artifact validation)
  // ===================================================================
  console.log('\n  PHASE 6 \u2014 RUNTIME\n')

  heading('Published Artifact Structure')

  // Validate artifacts directly (Node.js ESM can't load @navi/runtime TS source)
  const graphPath = join(DEMO, 'navigation.graph.json')
  if (existsSync(graphPath)) {
    const navGraph = JSON.parse(readFileSync(graphPath, 'utf-8'))
    const nodes = navGraph.nodes || []
    const edges = navGraph.edges || []
    check('Published graph has nodes', nodes.length > 0, `${nodes.length} nodes`)
    check('Published graph has edges', edges.length > 0, `${edges.length} edges`)
    check('Nodes have positions', nodes.filter(n => n.position).length === nodes.length,
      `${nodes.filter(n => n.position).length}/${nodes.length} with position`)

    // Validate search index
    const siPath = join(DEMO, 'search.index.json')
    if (existsSync(siPath)) {
      const si = JSON.parse(readFileSync(siPath, 'utf-8'))
      const entries = si.entries || si.documents || si.results || []
      check('Search index has entries', entries.length > 0, `${entries.length} entries`)
    } else {
      check('search.index.json exists', false)
    }

    // Validate POI data
    const poiPath = join(DEMO, 'poi.json')
    if (existsSync(poiPath)) {
      const poi = JSON.parse(readFileSync(poiPath, 'utf-8'))
      const items = poi.pois || poi.points || poi.locations || poi.entries || poi.data || []
      check('POI data has entries', items.length > 0, `${items.length} items`)
    } else {
      check('poi.json exists', false)
    }

    // Validate building index
    const biPath = join(DEMO, 'building-index.json')
    if (existsSync(biPath)) {
      const bi = JSON.parse(readFileSync(biPath, 'utf-8'))
      const buildings = bi.buildings || []
      check('Building index has entries', buildings.length > 0, `${buildings.length} buildings`)
      check('Building has name', buildings.some(b => b.name), buildings.map(b => b.name).join(', '))
    } else {
      check('building-index.json exists', false)
    }

    // Validate manifest (uses compilerVersion, not version; artifacts is an object, not array)
    const manifestPath = join(DEMO, 'manifest.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      check('Manifest has compiler version', !!manifest.compilerVersion, manifest.compilerVersion || 'missing')
      check('Manifest has artifacts', typeof manifest.artifacts === 'object' && manifest.artifacts !== null,
        `${Object.keys(manifest.artifacts || {}).length} artifact entries`)
    } else {
      check('manifest.json exists', false)
    }
  } else {
    check('navigation.graph.json exists', false)
  }

  // ===================================================================
  // REPORT
  // ===================================================================
  console.log()
  console.log('='.repeat(70))
  console.log('  GATE 5 \u2014 UAT VERIFICATION MATRIX')
  console.log('='.repeat(70))
  if (failures.length > 0) {
    console.log(`\n  FAILURES (${failures.length}):`)
    failures.forEach(f => console.log(`    \u2717 ${f}`))
  }
  console.log(`\n  Page errors: ${pageErrors.length}`)
  pageErrors.forEach((e, i) => console.log(`    ${i + 1}. ${e}`))
  console.log(`\n  ${passCount} passed, ${failCount} failed`)
  console.log(`  GATE 5 ${failCount === 0 ? 'PASS' : 'FAIL'}\n`)

  const allPass = failCount === 0
  await page.screenshot({ path: join(__dirname, 'e2e-p1.1-gate5-uat.png') })
  await browser.close()
  process.exit(allPass ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
