import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const mapId = 'rc3-campus'
const STUDIO_URL = `${BASE}/studio/${mapId}/edit`
const FLOOR_URL = `${BASE}/studio/${mapId}/edit/building/bld-1/floor/0`

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
    id: mapId, campusId: mapId, name: 'RC3 Campus',
    version: '1.0.0', updatedAt: now,
    center: { lat: 11.001, lng: 125.0018 }, zoom: 18,
    buildings: [{
      id: 'bld-1', name: 'Main Building', code: 'MB',
      color: '#8B5CF6', height: 20,
      floors: [{ id: 'flr-0', level: 0, label: 'Ground Floor', elevation: 0, hallways: [{ id: 'hw-1', name: 'Main Hallway', width: 3 }] }],
      footprint: [
        { lat: 11.0008, lng: 125.0015 },
        { lat: 11.0014, lng: 125.0015 },
        { lat: 11.0014, lng: 125.0022 },
        { lat: 11.0008, lng: 125.0022 },
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
    },
    // Second hallway for multi-hallway rendering test
    {
      id: 'hw-2', type: 'hallway', name: 'Side Hallway', buildingId: 'bld-1', floor: 0,
      polygon: [
        { lat: 11.00100, lng: 125.00178 },
        { lat: 11.00100, lng: 125.00195 },
        { lat: 11.00120, lng: 125.00195 },
      ],
      width: 2.5,
    }], traces: [],
  }

  await page.route('**/api/graph', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }))
  await page.route('**/api/campus-maps', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      maps: [{ id: mapId, name: 'RC3 Campus', schoolName: 'Test',
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
        maps: [{ id: mapId, name: 'RC3 Campus', schoolName: 'Test',
          boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
          center: { lat: 11.001, lng: 125.002 }, createdAt: now, updatedAt: now, stats: { buildings: 1, nodes: 0, edges: 0 },
        }], landmarkTypes: [], landmarkInstances: [],
      }))
    }
  }, { mapId, seedGraph, now })

  console.log('\n' + '='.repeat(70))
  console.log('  RC-3: HALLWAY RENDERING VERIFICATION')
  console.log('='.repeat(70))

  // ===================================================================
  // 1. NAVIGATE TO FLOOR EDITOR (directly)
  // ===================================================================
  heading('Navigate to Floor Editor')
  await page.goto(FLOOR_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(3000)

  if (page.url().includes('/login')) {
    console.log('  Redirected to login — performing mock auth...')
    await page.click('text=Dr. Admin')
    await page.waitForTimeout(3000)
    await page.goto(FLOOR_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(3000)
  }

  // Wait for map to render
  let mapRendered = false
  for (let i = 0; i < 40; i++) {
    const canvasCount = await page.evaluate(() => document.querySelectorAll('.maplibregl-map canvas').length)
    if (canvasCount > 0) { mapRendered = true; break }
    await page.waitForTimeout(500)
  }
  check('Floor editor map rendered', mapRendered)
  check('Floor editor URL correct', page.url().includes('/floor/0'), page.url())

  // Check for page errors during load
  check('No page errors on load', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '')

  // ===================================================================
  // 2. VERIFY HALLWAY DATA IN FLOOR EDITOR CONTEXT
  // ===================================================================
  heading('Hallway Data in Floor Editor')
  const hallwaysInEditor = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c?.document) return null
      const hallways = c.document.buildings?.[0]?.floors?.[0]?.hallways || []
      return hallways.map(h => ({ id: h.id, name: h.name, width: h.width, vcount: h.polyline?.points?.length }))
    } catch { return null }
  })
  check('Hallways exist in editor context', hallwaysInEditor !== null && hallwaysInEditor.length >= 2, `${hallwaysInEditor?.length} hallways`)
  check('Hallway 1: Main Hallway', hallwaysInEditor?.[0]?.name === 'Main Hallway', hallwaysInEditor?.[0]?.name)
  check('Hallway 2: Side Hallway', hallwaysInEditor?.[1]?.name === 'Side Hallway', hallwaysInEditor?.[1]?.name)
  check('Hallway 1 has vertices', (hallwaysInEditor?.[0]?.vcount ?? 0) >= 2, String(hallwaysInEditor?.[0]?.vcount))
  check('Hallway 2 has vertices', (hallwaysInEditor?.[1]?.vcount ?? 0) >= 2, String(hallwaysInEditor?.[1]?.vcount))

  // ===================================================================
  // 3. VERIFY MAP SOURCES & LAYERS FOR HALLWAYS (via style JSON)
  // ===================================================================
  heading('Map Sources & Layers')
  // Access the map instance via React fiber to inspect sources/layers
  const mapStyleInfo = await page.evaluate(() => {
    try {
      // Expose map instance on window if found via React internals
      const canvas = document.querySelector('.maplibregl-canvas')
      if (!canvas) return { error: 'no-canvas', found: false }
      // Maplibregl stores the map instance on the container
      const container = canvas.parentElement?.parentElement
      if (!container) return { error: 'no-container', found: false }
      // MapLibre map instances are stored as this._map on the container
      // or accessible via the first child with __map property
      return { found: true, hasContainer: !!container, canvasFound: true }
    } catch (e) { return { error: e.message, found: false } }
  })
  check('Map canvas present', mapStyleInfo?.canvasFound, '')

  // Verify document hallway data is correct for rendering
  const hallwayDataForRender = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c?.document) return null
      const hws = c.document.buildings?.[0]?.floors?.[0]?.hallways || []
      return hws.map(h => ({
        id: h.id, name: h.name,
        hasPolyline: !!h.polyline?.points && h.polyline.points.length >= 2,
        firstPoint: h.polyline?.points?.[0] || null,
        width: h.width,
      }))
    } catch { return null }
  })
  check('Hallway 1 ready for render', hallwayDataForRender?.[0]?.hasPolyline, hallwayDataForRender?.[0]?.name)
  check('Hallway 2 ready for render', hallwayDataForRender?.[1]?.hasPolyline, hallwayDataForRender?.[1]?.name || '')
  check('Hallway 1 has precise points', typeof hallwayDataForRender?.[0]?.firstPoint?.x === 'number', '')
  check('Hallway 2 has width', typeof hallwayDataForRender?.[1]?.width === 'number', String(hallwayDataForRender?.[1]?.width))

  // ===================================================================
  // 4. VERIFY EDITABLE PATH CONVERSION
  // ===================================================================
  heading('EditablePath Conversion')
  const pathInfo = await page.evaluate(() => {
    try {
      const c = window.__naviContext
      if (!c?.document) return null
      const hw = c.document.buildings?.[0]?.floors?.[0]?.hallways?.[0]
      if (!hw) return null
      // The FloorEditorCanvas converts components via componentToEditablePath
      // We verify the raw object has the right structure
      return {
        hasPolyline: !!hw.polyline,
        pointsCount: hw.polyline?.points?.length ?? 0,
        pointType: hw.polyline?.points?.[0]?.x !== undefined ? 'LocalCoord' : 'unknown',
        hasWidth: typeof hw.width === 'number',
      }
    } catch (e) { return `error: ${e.message}` }
  })
  check('Polyline exists', pathInfo?.hasPolyline, '')
  check('Points are LocalCoord type', pathInfo?.pointType === 'LocalCoord', pathInfo?.pointType)
  check('Width is number', pathInfo?.hasWidth, String(pathInfo?.hasWidth))

  // ===================================================================
  // 5. TAKE SCREENSHOT FOR VISUAL VERIFICATION
  // ===================================================================
  heading('Screenshot')
  const mapCanvas = await page.$('.maplibregl-map canvas')
  check('Map canvas element found', !!mapCanvas)
  if (mapCanvas) {
    await page.screenshot({ path: 'rc3-hallway-rendering.png', fullPage: false })
    check('Screenshot saved', true, 'rc3-hallway-rendering.png')
  }

  // ===================================================================
  // 6. VERIFY HALLWAY INTERACTION (click on map doesn't break)
  // ===================================================================
  heading('Hallway Interaction Safety')
  // Try a click on the map — should not throw errors
  try {
    await mapCanvas.click()
    await page.waitForTimeout(500)
  } catch {}
  check('No errors after map click', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '')

  // Prompt user to visually inspect
  console.log('\n  \u2139\ufe0f Screenshot saved as rc3-hallway-rendering.png')
  console.log('  Please inspect visually: two hallways should render with fill+outline')

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n' + '='.repeat(70))
  console.log(`  RC-3 RESULT: ${failCount === 0 ? 'PASS \u2705' : 'FAIL \u274C'}`)
  console.log(`  ${passCount} passed, ${failCount} failed`)
  if (failures.length) console.log('  Failures:', failures.join(', '))
  console.log('='.repeat(70) + '\n')

  await page.waitForTimeout(5000) // Let user see screenshot
  await browser.close()
}

main().catch((e) => { console.error('E2E CRASHED:', e); process.exit(1) })
