import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const mapId = 'rc2-campus'
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
  page.on('pageerror', (e) => pageErrors.push(e.message))

  const now = new Date().toISOString()
  const seedGraph = {
    id: mapId, campusId: mapId, name: 'RC2 Campus',
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

  await page.route('**/api/graph', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }))
  await page.route('**/api/campus-maps', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      maps: [{ id: mapId, name: 'RC2 Campus', schoolName: 'Test',
        boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
        center: { lat: 11.001, lng: 125.002 }, createdAt: now, updatedAt: now, stats: { buildings: 1, nodes: 0, edges: 0 },
      }], landmarkTypes: [], landmarkInstances: [],
    }) }))

  await ctx.addInitScript((args) => {
    const { mapId, seedGraph, now } = args
    const graphKey = `navi-graph-${mapId}`
    const campusKey = 'navi-campus-maps'
    if (!localStorage.getItem(graphKey)) {
      localStorage.setItem(graphKey, JSON.stringify(seedGraph))
      localStorage.setItem(campusKey, JSON.stringify({
        maps: [{ id: mapId, name: 'RC2 Campus', schoolName: 'Test',
          boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
          center: { lat: 11.001, lng: 125.002 }, createdAt: now, updatedAt: now, stats: { buildings: 1, nodes: 0, edges: 0 },
        }], landmarkTypes: [], landmarkInstances: [],
      }))
    }
  }, { mapId, seedGraph, now })

  console.log('\n' + '='.repeat(70))
  console.log('  RC-2: HALLWAY EDITING + COMPLEX UNDO/REDO')
  console.log('='.repeat(70))

  heading('Open Campus Editor')
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  if (page.url().includes('/login')) {
    console.log('  Redirected to login — performing mock auth...')
    await page.click('text=Dr. Admin')
    await page.waitForTimeout(3000)
    await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)
  }
  let editorReady = false
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!document.querySelector('[data-editor-ready]'))) { editorReady = true; break }
    await page.waitForTimeout(500)
  }
  check('Editor context initialized', editorReady)
  if (!editorReady) { await browser.close(); process.exit(1) }

  // Helper: read hallway 0 state
  const getHw = () => page.evaluate(() => {
    const h = window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways?.[0]
    return h ? { name: h.name, width: h.width, vcount: h.polyline?.points?.length } : null
  })
  const countHw = () => page.evaluate(() =>
    window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways?.length || 0)

  // Helper: execute dispatcher command
  const exec = (id, label, payload) => page.evaluate(({ id, label, payload }) => {
    try {
      const d = window.__naviContext?.services?.get?.('dispatcher')
      if (!d) return 'no-dispatcher'
      d.execute({ id, label, payload })
      return 'ok'
    } catch (e) { return String(e) }
  }, { id, label, payload })

  // Helper: undo/redo
  const undo = () => page.evaluate(() => { const h = window.__naviHistory; if (h?.canUndo) h.undo() })
  const redo = () => page.evaluate(() => { const h = window.__naviHistory; if (h?.canRedo) h.redo() })

  // ===================================================================
  // 1. RENAME HALLWAY via entity.update
  // ===================================================================
  heading('Rename Hallway')
  let r = await exec('entity.update', 'Rename', { entityId: 'hw-1', changes: { name: 'Renamed Hallway' } })
  check('Rename executed', r === 'ok', r)
  let s = await getHw()
  check('Name changed', s?.name === 'Renamed Hallway', s?.name)

  await undo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Undo restores original name', s?.name === 'Main Hallway', s?.name)

  await redo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Redo reapplies rename', s?.name === 'Renamed Hallway', s?.name)

  // ===================================================================
  // 2. CHANGE WIDTH via entity.update
  // ===================================================================
  heading('Change Width')
  r = await exec('entity.update', 'Width', { entityId: 'hw-1', changes: { width: 6 } })
  check('Width change executed', r === 'ok', r)
  s = await getHw()
  check('Width changed to 6', s?.width === 6, String(s?.width))

  await undo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Undo restores width 3', s?.width === 3, String(s?.width))

  await redo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Redo restores width 6', s?.width === 6, String(s?.width))

  // ===================================================================
  // 3. MODIFY VERTEX via entity.update
  // ===================================================================
  heading('Modify Vertex')
  const vertexMoveResult = await exec('entity.update', 'Move Vertex', {
    entityId: 'hw-1',
    changes: { polyline: { points: [{ x: 10, y: 10 }, { x: -2, y: 4 }, { x: 4, y: 4 }, { x: 8, y: -2 }] } }
  })
  check('Vertex move executed', vertexMoveResult === 'ok', vertexMoveResult)
  const vertexState = await page.evaluate(() => {
    const h = window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways?.[0]
    return h?.polyline?.points?.[0]
  })
  check('First vertex changed', vertexState?.x === 10 && vertexState?.y === 10, `${vertexState?.x},${vertexState?.y}`)

  await undo(); await page.waitForTimeout(200)
  const vertexUndone = await page.evaluate(() => {
    const h = window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways?.[0]
    return h?.polyline?.points?.[0]
  })
  check('Undo vertex restored original', vertexUndone?.x !== 10, '')

  await redo(); await page.waitForTimeout(200)
  const vertexRedone = await page.evaluate(() => {
    const h = window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways?.[0]
    return h?.polyline?.points?.[0]
  })
  check('Redo vertex reapplied', vertexRedone?.x === 10 && vertexRedone?.y === 10, `${vertexRedone?.x},${vertexRedone?.y}`)

  // ===================================================================
  // 4. CHAIN: three sequential edits, undo all, redo all, undo one
  // ===================================================================
  heading('3-Edit Chain')

  // Now execute 3 edits in sequence (name→width→vertex) without undoing in between
  // Current state: name='Renamed Hallway', width=6, vertex moved (x=10)
  r = await exec('entity.update', 'Chain Rename', { entityId: 'hw-1', changes: { name: 'Chained' } })
  check('Chain: name edit ok', r === 'ok', r)
  await page.waitForTimeout(100)

  r = await exec('entity.update', 'Chain Width', { entityId: 'hw-1', changes: { width: 9 } })
  check('Chain: width edit ok', r === 'ok', r)
  await page.waitForTimeout(100)

  r = await exec('entity.update', 'Chain Vertex', { entityId: 'hw-1', changes: { polyline: { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } } })
  check('Chain: vertex edit ok', r === 'ok', r)
  await page.waitForTimeout(200)

  s = await getHw()
  check('Chain: all edits applied', s?.name === 'Chained' && s?.width === 9, `${s?.name}, w=${s?.width}`)

  // Undo all 3
  await undo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Undo vertex: width still 9', s?.width === 9, String(s?.width))
  check('Undo vertex: name still Chained', s?.name === 'Chained', s?.name)

  await undo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Undo width: width restored to 6', s?.width === 6, String(s?.width))
  check('Undo width: name still Chained', s?.name === 'Chained', s?.name)

  await undo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Undo name: name restored', s?.name === 'Renamed Hallway', s?.name)
  check('Undo name: width still 6', s?.width === 6, String(s?.width))

  // Redo all 3
  await redo(); await page.waitForTimeout(100)
  await redo(); await page.waitForTimeout(100)
  await redo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Redo all: name Chained', s?.name === 'Chained', s?.name)
  check('Redo all: width 9', s?.width === 9, String(s?.width))

  // ===================================================================
  // 5. BRANCHING: undo 2 → new edit → old redo should be lost
  // ===================================================================
  heading('Branching Undo')

  // Undo vertex + width (2 undos)
  await undo(); await page.waitForTimeout(100)
  await undo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Branch start: width 6 name Chained', s?.width === 6 && s?.name === 'Chained', `${s?.name}, w=${s?.width}`)

  // Make a NEW edit (should branch, losing vertex redo)
  r = await exec('entity.update', 'Branch Edit', { entityId: 'hw-1', changes: { name: 'Branch Test' } })
  check('Branch edit executed', r === 'ok', r)
  await page.waitForTimeout(200)
  s = await getHw()
  check('Branch edit: name changed', s?.name === 'Branch Test', s?.name)

  // Undo branch edit
  await undo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Undo branch: name restored', s?.name === 'Chained', s?.name)

  // Redo branch edit
  await redo(); await page.waitForTimeout(200)
  s = await getHw()
  check('Redo branch: name Branch Test', s?.name === 'Branch Test', s?.name)

  // Try to redo again — should NOT restore vertex (lost at branch point)
  const canRedoExtra = await page.evaluate(() => window.__naviHistory?.canRedo)
  check('Branch lost old vertex redo', !canRedoExtra, String(canRedoExtra))

  // ===================================================================
  // 6. SAVE & RELOAD after edits
  // ===================================================================
  heading('Save & Reload After Edits')

  const saveOk = await page.evaluate(async () => {
    try {
      const wf = window.__naviContext?.services?.get?.('workflow')
      if (!wf || typeof wf.save !== 'function') return 'no-workflow'
      await wf.save('manual')
      return 'ok'
    } catch (e) { return String(e) }
  })
  check('Save executed', saveOk === 'ok', saveOk)

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
    if (await page.evaluate(() => !!document.querySelector('[data-editor-ready]'))) { reReady = true; break }
    await page.waitForTimeout(500)
  }
  check('Editor re-initialized', reReady)

  const afterReload = await getHw()
  check('Branch hallway preserved', afterReload?.name === 'Branch Test', afterReload?.name)
  check('Width preserved', afterReload?.width === 6, String(afterReload?.width))
  check('Vertices preserved', (afterReload?.vcount ?? 0) >= 2, String(afterReload?.vcount))

  // ===================================================================
  // 7. MULTI-HALLWAY EDITING
  // ===================================================================
  heading('Multi-Hallway Editing')

  // Create a second hallway
  r = await exec('hallway.create', 'Create 2nd', {
    buildingId: 'bld-1', floorId: 'flr-0', name: 'Second Hallway',
    points: [{ x: -5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 0 }], width: 2
  })
  check('Second hallway created', r === 'ok', r)
  check('Total 2 hallways', await countHw() === 2, String(await countHw()))

  // Rename first hallway independently
  r = await exec('entity.update', 'Rename First', { entityId: 'hw-1', changes: { name: 'First Hallway' } })
  check('First renamed', r === 'ok', r)

  const namesAfterMulti = await page.evaluate(() => {
    return (window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways || []).map(h => h.name)
  })
  check('First hallway name correct', namesAfterMulti?.[0] === 'First Hallway', namesAfterMulti?.[0])
  check('Second hallway name correct', namesAfterMulti?.[1] === 'Second Hallway', namesAfterMulti?.[1])

  // Undo first rename (should only affect first hallway)
  await undo(); await page.waitForTimeout(200)
  const namesAfterUndoMulti = await page.evaluate(() => {
    return (window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways || []).map(h => h.name)
  })
  check('Undo first rename: first restored', namesAfterUndoMulti?.[0] === 'Branch Test', namesAfterUndoMulti?.[0])
  check('Undo first rename: second unchanged', namesAfterUndoMulti?.[1] === 'Second Hallway', namesAfterUndoMulti?.[1])

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n' + '='.repeat(70))
  console.log(`  RC-2 RESULT: ${failCount === 0 ? 'PASS \u2705' : 'FAIL \u274C'}`)
  console.log(`  ${passCount} passed, ${failCount} failed`)
  if (failures.length) console.log('  Failures:', failures.join(', '))
  console.log('='.repeat(70) + '\n')

  check('No page errors', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '')
  await browser.close()
}

main().catch((e) => { console.error('E2E CRASHED:', e); process.exit(1) })
