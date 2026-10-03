import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const mapId = 'rc1-campus'
const STUDIO_URL = `${BASE}/studio/${mapId}/edit`

let passCount = 0
let failCount = 0
const failures = []
function check(label, ok, detail) {
  process.stdout.write(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` (${detail})` : ''}\n`)
  if (ok) passCount++; else { failCount++; failures.push(label) }
}
function heading(s) { process.stdout.write(`\n  \u2500\u2500 ${s} \u2500\u2500\n`) }

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  const now = new Date().toISOString()
  const seedGraph = {
    id: mapId, campusId: mapId, name: 'RC1 Campus',
    version: '1.0.0', updatedAt: now,
    center: { lat: 11.001, lng: 125.0018 }, zoom: 18,
    buildings: [{
      id: 'bld-1', name: 'Main Building', code: 'MB',
      color: '#8B5CF6', height: 20,
      floors: [{ id: 'flr-0', level: 0, label: 'Ground Floor', elevation: 0, hallways: [{ id: 'hw-1', name: 'Main Hallway', width: 3 }] }],
      footprint: [
        { lat: 11.0009, lng: 125.0016 },
        { lat: 11.0012, lng: 125.0016 },
        { lat: 11.0012, lng: 125.0020 },
        { lat: 11.0009, lng: 125.0020 },
      ],
    }],
    nodes: [], edges: [], components: [{
      id: 'hw-1', type: 'hallway', name: 'Main Hallway', buildingId: 'bld-1', floor: 0,
      polygon: [
        { lat: 11.00093, lng: 125.00163 },
        { lat: 11.00096, lng: 125.00178 },
        { lat: 11.00112, lng: 125.00178 },
        { lat: 11.00115, lng: 125.00163 },
      ],
      width: 3,
    }], traces: [],
  }

  // Mock API routes to prevent DB fetches from clobbering localStorage
  await page.route('**/api/graph', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }))
  await page.route('**/api/campus-maps', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      maps: [{
        id: mapId, name: 'RC1 Campus', schoolName: 'Test',
        boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
        center: { lat: 11.001, lng: 125.002 },
        createdAt: now, updatedAt: now,
        stats: { buildings: 1, nodes: 0, edges: 0 },
      }],
      landmarkTypes: [], landmarkInstances: [],
    }) }))

  // Seed data into localStorage
  await ctx.addInitScript((args) => {
    const { mapId, seedGraph, now } = args
    const graphKey = `navi-graph-${mapId}`
    const campusKey = 'navi-campus-maps'
    // Only seed if not already saved (preserves state across save→reload cycles)
    if (!localStorage.getItem(graphKey)) {
      localStorage.setItem(graphKey, JSON.stringify(seedGraph))
      localStorage.setItem(campusKey, JSON.stringify({
        maps: [{
          id: mapId, name: 'RC1 Campus', schoolName: 'Test',
          boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
          center: { lat: 11.001, lng: 125.002 },
          createdAt: now, updatedAt: now,
          stats: { buildings: 1, nodes: 0, edges: 0 },
        }],
        landmarkTypes: [], landmarkInstances: [],
      }))
    }
  }, { mapId, seedGraph, now })

  console.log('\n' + '='.repeat(70))
  console.log('  RC-1: HALLWAY CREATION VERIFICATION')
  console.log('='.repeat(70))

  // Navigate to campus editor
  heading('Open Campus Editor')
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Handle login redirect
  if (page.url().includes('/login')) {
    console.log('  Redirected to login — performing mock auth...')
    await page.click('text=Dr. Admin')
    await page.waitForTimeout(3000)
    await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)
  }

  // Wait for editor context
  let editorReady = false
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => !!document.querySelector('[data-editor-ready]'))
    if (ready) { editorReady = true; break }
    await page.waitForTimeout(500)
  }
  check('Editor context initialized', editorReady)

  if (!editorReady) {
    console.log('  Editor not ready — cannot continue verification')
    console.log('  Current URL:', page.url())
    const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 300))
    console.log('  Body:', bodySnippet)
    await browser.close()
    process.exit(1)
  }

  // Helper: access services via __naviContext.services.get()
  const GET_SVC = `(id) => {
    const c = window.__naviContext
    return c && typeof c.services?.get === 'function' ? c.services.get(id) : null
  }`

  // ===================================================================
  // 1. HALLWAY EXISTS (seeded in data)
  // ===================================================================
  heading('Hallway Exists in Document')
  const seededHallway = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c) return null
      const doc = c.document
      if (!doc) return null
      const f = doc.buildings?.[0]?.floors?.[0]
      if (!f?.hallways?.length) return null
      const h = f.hallways[0]
      return { name: h.name, vertexCount: h.polyline?.points?.length, width: h.width, id: h.id }
    } catch { return null }
  })
  check('Seeded hallway exists in document', seededHallway !== null)
  check('Hallway has name', seededHallway?.name === 'Main Hallway', seededHallway?.name)
  check('Hallway has vertices', (seededHallway?.vertexCount ?? 0) >= 2, String(seededHallway?.vertexCount))
  check('Hallway has width', seededHallway?.width === 3, String(seededHallway?.width))
  check('No page errors so far', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '')

  // ===================================================================
  // 2. SKIP: Floor Editor Interaction — UI navigation to floor editor
  //    requires clicking building on map first, not part of RC-1 spec.
  // ===================================================================

  // ===================================================================
  // 3. CREATE NEW HALLWAY via dispatcher
  // ===================================================================
  heading('Create New Hallway')
  const newHwId = 'hw-new-' + Date.now()
  const createResult = await page.evaluate((hwId) => {
    try {
      const c = window.__naviContext
      if (!c) return 'no-context'
      const dispatcher = c.services?.get?.('dispatcher')
      if (!dispatcher) return 'no-dispatcher'
      const doc = c.document
      if (!doc) return 'no-document'
      const b = doc.buildings?.[0]
      const f = b?.floors?.[0]
      if (!b || !f) return 'no-building-or-floor'
      dispatcher.execute({
        id: 'hallway.create', label: 'Create Hallway',
        payload: { buildingId: b.id, floorId: f.id, name: 'New Hallway', points: [{ x: -8, y: -2 }, { x: -2, y: 4 }, { x: 4, y: 4 }, { x: 8, y: -2 }], width: 4 },
      })
      return 'ok'
    } catch (e) { return String(e) }
  }, newHwId)
  check('New hallway created via dispatcher', createResult === 'ok', createResult)

  const newHallwayData = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c?.document) return null
      const hallways = c.document.buildings?.[0]?.floors?.[0]?.hallways || []
      return hallways.map((h) => ({ name: h.name, vertexCount: h.polyline?.points?.length, width: h.width }))
    } catch { return null }
  })
  check('Created hallway appears in document', newHallwayData?.length === 2, `${newHallwayData?.length} hallways`)
  check('New hallway has name', newHallwayData?.[1]?.name === 'New Hallway', newHallwayData?.[1]?.name)
  check('New hallway has width 4', newHallwayData?.[1]?.width === 4, String(newHallwayData?.[1]?.width))

  // ===================================================================
  // 4. UNDO / REDO
  // ===================================================================
  heading('Undo / Redo')

  const undoRedoEval = async () => {
    return page.evaluate(() => {
      try {
        const c = window.__naviContext
        const history = c?.services?.get?.('history') ?? window.__naviHistory
        if (!history) return 'no-history'
        return 'ok'
      } catch (e) { return String(e) }
    })
  }

  const countHallways = () => page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c?.document) return -1
      return c.document.buildings?.[0]?.floors?.[0]?.hallways?.length || 0
    } catch { return -1 }
  })

  // Undo
  const undoOk = await page.evaluate(() => {
    try {
      const h = window.__naviHistory
      if (!h?.undo) return 'no-history'
      h.undo()
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Undo performed', undoOk === 'ok', undoOk)

  await page.waitForTimeout(300)
  const countAfterUndo = await countHallways()
  check('New hallway removed by undo', countAfterUndo === 1, `${countAfterUndo} hallways`)

  // Redo
  const redoOk = await page.evaluate(() => {
    try {
      const h = window.__naviHistory
      if (!h?.redo) return 'no-history'
      h.redo()
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Redo performed', redoOk === 'ok', redoOk)

  await page.waitForTimeout(300)
  const countAfterRedo = await countHallways()
  check('New hallway restored by redo', countAfterRedo === 2, `${countAfterRedo} hallways`)

  // ===================================================================
  // 5. SAVE & RELOAD
  // ===================================================================
  heading('Save & Reload')

  await page.waitForTimeout(1500)
  const saveResult = await page.evaluate(async () => {
    try {
      const c = window.__naviContext
      const wf = c?.services?.get?.('workflow')
      if (!wf || typeof wf.save !== 'function') return 'no-workflow-service'
      await wf.save('manual')
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Save executed', saveResult === 'ok', saveResult)

  // Reload
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  if (page.url().includes('/login')) {
    await page.click('text=Dr. Admin')
    await page.waitForTimeout(3000)
    await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)
  }

  let reReady = false
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => !!document.querySelector('[data-editor-ready]'))
    if (ready) { reReady = true; break }
    await page.waitForTimeout(500)
  }
  check('Editor re-initialized after reload', reReady)

  const hallwaysAfterReload = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c?.document) return null
      const hallways = c.document.buildings?.[0]?.floors?.[0]?.hallways || []
      return hallways.map((h) => ({ name: h.name, vertexCount: h.polyline?.points?.length, width: h.width }))
    } catch { return null }
  })
  check('Hallways persisted after reload', hallwaysAfterReload?.length === 2, `${hallwaysAfterReload?.length} hallways`)
  check('Seeded hallway preserved', hallwaysAfterReload?.[0]?.name === 'Main Hallway', hallwaysAfterReload?.[0]?.name)
  check('New hallway preserved', hallwaysAfterReload?.[1]?.name === 'New Hallway', hallwaysAfterReload?.[1]?.name)
  check('New hallway width preserved', hallwaysAfterReload?.[1]?.width === 4, String(hallwaysAfterReload?.[1]?.width))
  check('No page errors after reload', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '')

  // ===================================================================
  // 6. HALLWAY UPDATE (entity.update)
  // ===================================================================
  heading('Hallway Update')
  const updateResult = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c) return 'no-context'
      const dispatcher = c.services?.get?.('dispatcher')
      if (!dispatcher) return 'no-dispatcher'
      const doc = c.document
      if (!doc) return 'no-document'
      const h = doc.buildings?.[0]?.floors?.[0]?.hallways?.[0]
      if (!h) return 'no-hallway'
      dispatcher.execute({
        id: 'entity.update', label: 'Rename Hallway',
        payload: { entityId: h.id, changes: { name: 'Updated Hallway' } },
      })
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Hallway update executed', updateResult === 'ok', updateResult)

  const updatedName = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c?.document) return ''
      return c.document.buildings?.[0]?.floors?.[0]?.hallways?.[0]?.name || ''
    } catch { return '' }
  })
  check('Hallway name updated', updatedName === 'Updated Hallway', updatedName)

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n' + '='.repeat(70))
  console.log(`  RC-1 RESULT: ${failCount === 0 ? 'PASS \u2705' : 'FAIL \u274C'}`)
  console.log(`  ${passCount} passed, ${failCount} failed`)
  if (failures.length) console.log('  Failures:', failures.join(', '))
  console.log('='.repeat(70) + '\n')

  await browser.close()
}

main().catch((e) => { console.error('E2E CRASHED:', e); process.exit(1) })
