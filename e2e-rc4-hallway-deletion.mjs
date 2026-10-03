import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const mapId = 'rc4-campus'
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
    id: mapId, campusId: mapId, name: 'RC4 Campus',
    version: '1.0.0', updatedAt: now,
    center: { lat: 11.001, lng: 125.0018 }, zoom: 18,
    buildings: [{
      id: 'bld-1', name: 'Main Building', code: 'MB',
      color: '#8B5CF6', height: 20,
      floors: [{ id: 'flr-0', level: 0, label: 'Ground Floor', elevation: 0,
        hallways: [
          { id: 'hw-1', name: 'Main Hallway', width: 3 },
          { id: 'hw-2', name: 'Side Hallway', width: 2.5 },
          { id: 'hw-3', name: 'East Wing', width: 4 },
        ]
      }],
      footprint: [
        { lat: 11.0008, lng: 125.0015 },
        { lat: 11.0014, lng: 125.0015 },
        { lat: 11.0014, lng: 125.0022 },
        { lat: 11.0008, lng: 125.0022 },
      ],
    }],
    nodes: [], edges: [], components: [
      { id: 'hw-1', type: 'hallway', name: 'Main Hallway', buildingId: 'bld-1', floor: 0,
        polygon: [{ lat: 11.00093, lng: 125.00163 }, { lat: 11.00096, lng: 125.00178 }, { lat: 11.00112, lng: 125.00178 }, { lat: 11.00115, lng: 125.00163 }], width: 3 },
      { id: 'hw-2', type: 'hallway', name: 'Side Hallway', buildingId: 'bld-1', floor: 0,
        polygon: [{ lat: 11.00100, lng: 125.00178 }, { lat: 11.00100, lng: 125.00195 }, { lat: 11.00120, lng: 125.00195 }], width: 2.5 },
      { id: 'hw-3', type: 'hallway', name: 'East Wing', buildingId: 'bld-1', floor: 0,
        polygon: [{ lat: 11.00112, lng: 125.00178 }, { lat: 11.00112, lng: 125.00195 }, { lat: 11.00125, lng: 125.00195 }, { lat: 11.00125, lng: 125.00178 }], width: 4 },
    ], traces: [],
  }

  await page.route('**/api/graph', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }))
  await page.route('**/api/campus-maps', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      maps: [{ id: mapId, name: 'RC4 Campus', schoolName: 'Test',
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
        maps: [{ id: mapId, name: 'RC4 Campus', schoolName: 'Test',
          boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
          center: { lat: 11.001, lng: 125.002 }, createdAt: now, updatedAt: now, stats: { buildings: 1, nodes: 0, edges: 0 },
        }], landmarkTypes: [], landmarkInstances: [],
      }))
    }
  }, { mapId, seedGraph, now })

  console.log('\n' + '='.repeat(70))
  console.log('  RC-4: HALLWAY DELETION + EDGE CASES')
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

  const exec = (id, label, payload) => page.evaluate(({ id, label, payload }) => {
    try {
      const d = window.__naviContext?.services?.get?.('dispatcher')
      if (!d) return JSON.stringify({ success: false, error: 'no-dispatcher' })
      const result = d.execute({ id, label, payload })
      return JSON.stringify(result)
    } catch (e) { return JSON.stringify({ success: false, error: String(e) }) }
  }, { id, label, payload })

  const countHw = () => page.evaluate(() =>
    window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways?.length || 0)

  const getNames = () => page.evaluate(() =>
    (window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways || []).map(h => h.name))

  const undo = () => page.evaluate(() => { const h = window.__naviHistory; if (h?.canUndo) h.undo() })
  const redo = () => page.evaluate(() => { const h = window.__naviHistory; if (h?.canRedo) h.redo() })

  // ===================================================================
  // 1. DELETE SEEDED HALLWAY
  // ===================================================================
  heading('Delete Seeded Hallway')
  check('Initial 3 hallways', await countHw() === 3, String(await countHw()))

  // Delete hw-2 (Side Hallway)
  let r = await exec('hallway.delete', 'Delete Side Hallway', { hallwayId: 'hw-2', buildingId: 'bld-1', floorId: 'flr-0' })
  const rDelete = JSON.parse(r)
  check('Delete executed', rDelete.success, r)
  check('2 hallways remain', await countHw() === 2, String(await countHw()))
  let names = await getNames()
  check('hw-2 removed', !names.includes('Side Hallway'), names.join(','))
  check('hw-1 preserved', names.includes('Main Hallway'), '')
  check('hw-3 preserved', names.includes('East Wing'), '')

  // Undo delete (restores via snapshot)
  await undo(); await page.waitForTimeout(200)
  check('Undo restores hallways', await countHw() === 3, String(await countHw()))
  names = await getNames()
  check('Side Hallway restored', names.includes('Side Hallway'), names.join(','))

  // Redo delete
  await redo(); await page.waitForTimeout(200)
  check('Redo deletes again', await countHw() === 2, String(await countHw()))

  // ===================================================================
  // 2. DELETE LAST REMAINING HALLWAY
  // ===================================================================
  heading('Delete Remaining Hallways')
  r = await exec('hallway.delete', 'Delete hw-1', { hallwayId: 'hw-1', buildingId: 'bld-1', floorId: 'flr-0' })
  check('Delete hw-1 ok', JSON.parse(r).success, r)
  r = await exec('hallway.delete', 'Delete hw-3', { hallwayId: 'hw-3', buildingId: 'bld-1', floorId: 'flr-0' })
  check('Delete hw-3 ok', JSON.parse(r).success, r)
  check('No hallways left', await countHw() === 0, String(await countHw()))

  // Undo both
  await undo(); await page.waitForTimeout(200)
  check('Undo 1: 1 hallway', await countHw() === 1, String(await countHw()))
  await undo(); await page.waitForTimeout(200)
  check('Undo 2: 2 hallways', await countHw() === 2, String(await countHw()))

  // ===================================================================
  // 3. DELETE NEWLY CREATED HALLWAY (create → delete)
  // ===================================================================
  heading('Create Then Delete')

  // Re-create hw-1 for the next tests
  r = await exec('hallway.create', 'Create New', {
    buildingId: 'bld-1', floorId: 'flr-0', name: 'Temporary Hallway',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], width: 3
  })
  check('Create temporary hallway', JSON.parse(r).success, r)
  check('3 hallways', await countHw() === 3, String(await countHw()))

  // Delete it by finding its ID
  const tempHwId = await page.evaluate(() => {
    const hws = window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways || []
    const temp = hws.find(h => h.name === 'Temporary Hallway')
    return temp?.id || null
  })
  check('Temporary hallway has ID', tempHwId !== null, tempHwId || '')

  r = await exec('hallway.delete', 'Delete Temp', { hallwayId: tempHwId, buildingId: 'bld-1', floorId: 'flr-0' })
  check('Delete temporary hallway', JSON.parse(r).success, r)
  check('Back to 2 hallways', await countHw() === 2, String(await countHw()))

  // Undo delete
  await undo(); await page.waitForTimeout(200)
  check('Undo restore temp hallway', await countHw() === 3, String(await countHw()))
  names = await getNames()
  check('Temporary Hallway back', names.includes('Temporary Hallway'), names.join(','))

  // ===================================================================
  // 4. EDGE CASE: DELETE NON-EXISTENT HALLWAY
  // ===================================================================
  heading('Edge Cases')
  r = await exec('hallway.delete', 'Delete Fake', { hallwayId: 'does-not-exist', buildingId: 'bld-1', floorId: 'flr-0' })
  const rDeleteFake = JSON.parse(r)
  check('Delete non-existent returns error', !rDeleteFake.success, rDeleteFake.error || r)
  check('Hallway count unchanged', await countHw() === 3, String(await countHw()))

  // ===================================================================
  // 5. EDGE CASE: DELETE FROM NON-EXISTENT FLOOR (handler looks up by ID)
  // ===================================================================
  r = await exec('hallway.delete', 'Delete Wrong Floor', { hallwayId: 'hw-1', buildingId: 'bld-1', floorId: 'nope' })
  const rWrongFloor = JSON.parse(r)
  check('Delete by ID works (ignores wrong floor)', rWrongFloor.success, r)
  check('hw-1 was removed', !(await getNames()).includes('Main Hallway'), '')
  // Undo to restore hw-1
  await undo(); await page.waitForTimeout(200)
  check('Undo restores hw-1', (await getNames()).includes('Main Hallway'), '')

  // ===================================================================
  // 6. EDGE CASE: DELETE SINGLE VERTEX HALLWAY (min 2 vertices)
  // ===================================================================
  r = await exec('hallway.create', 'Minimal Hallway', {
    buildingId: 'bld-1', floorId: 'flr-0', name: 'Minimal Hallway',
    points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], width: 2
  })
  const rMinCreate = JSON.parse(r)
  check('Create 2-vertex hallway', rMinCreate.success, r)
  check('4 hallways', await countHw() === 4, String(await countHw()))

  const minHwId = await page.evaluate(() => {
    const hws = window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways || []
    const m = hws.find(h => h.name === 'Minimal Hallway')
    return m?.id || null
  })
  r = await exec('hallway.delete', 'Delete Minimal', { hallwayId: minHwId, buildingId: 'bld-1', floorId: 'flr-0' })
  const rMinDelete = JSON.parse(r)
  check('Delete 2-vertex hallway', rMinDelete.success, r)
  check('Back to 3 hallways', await countHw() === 3, String(await countHw()))

  // Undo delete
  await undo(); await page.waitForTimeout(200)
  check('Undo restore minimal', await countHw() === 4, String(await countHw()))

  // ===================================================================
  // 7. SAVE & RELOAD AFTER MIX OF CREATE/DELETE
  // ===================================================================
  heading('Save & Reload')
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

  const afterReload = await page.evaluate(() => {
    const hws = window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.hallways || []
    return { count: hws.length, names: hws.map(h => h.name) }
  })
  check('4 hallways after reload', afterReload?.count === 4, String(afterReload?.count))
  check('Minimal Hallway preserved', afterReload?.names?.includes('Minimal Hallway'), '')
  check('Temporary Hallway preserved', afterReload?.names?.includes('Temporary Hallway'), '')

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n' + '='.repeat(70))
  console.log(`  RC-4 RESULT: ${failCount === 0 ? 'PASS \u2705' : 'FAIL \u274C'}`)
  console.log(`  ${passCount} passed, ${failCount} failed`)
  if (failures.length) console.log('  Failures:', failures.join(', '))
  console.log('='.repeat(70) + '\n')

  check('No page errors', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '')
  await browser.close()
}

main().catch((e) => { console.error('E2E CRASHED:', e); process.exit(1) })
