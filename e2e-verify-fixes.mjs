import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const MAP_ID = 'map-1783994563934-02fbn'
const user = { id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null }
const encoded = Buffer.from(JSON.stringify(user)).toString('base64')

const campusMaps = {
  maps: [
    { id: MAP_ID, name: 'ASU Ibajay', schoolName: 'Ateneo de Naga', campusName: 'Ibajay',
      center: { lat: 11.0008, lng: 125.0015 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      stats: { buildings: 3, nodes: 0, edges: 0 } },
  ],
  landmarkTypes: [], landmarkInstances: [],
}

// 3 valid-footprint buildings + 1 empty-footprint (should be filtered, not crash)
const graphSnapshot = {
  id: MAP_ID, campusId: 'asu-ibajay', version: '1.0.0', updatedAt: new Date().toISOString(),
  buildings: [
    { id: 'b1', name: 'Science Hall', campusId: 'asu-ibajay', floors: [0],
      footprint: [{lat:11.0000,lng:125.0000},{lat:11.0010,lng:125.0000},{lat:11.0010,lng:125.0010},{lat:11.0000,lng:125.0010}],
      baseElevation:0, height:15, color:'#1C6BEB', aliases:[], metadata:{} },
    { id: 'b-empty', name: 'Broken Footprint Bldg', campusId: 'asu-ibajay', floors: [0],
      footprint: [], baseElevation:0, height:15, color:'#ff0000', aliases:[], metadata:{} },
    { id: 'b2', name: 'Library', campusId: 'asu-ibajay', floors: [0],
      footprint: [{lat:11.0020,lng:125.0020},{lat:11.0030,lng:125.0020},{lat:11.0030,lng:125.0030},{lat:11.0020,lng:125.0030}],
      baseElevation:0, height:15, color:'#1C6BEB', aliases:[], metadata:{} },
    { id: 'b3', name: 'Admin', campusId: 'asu-ibajay', floors: [0],
      footprint: [{lat:11.0005,lng:125.0025},{lat:11.0015,lng:125.0025},{lat:11.0015,lng:125.0035},{lat:11.0005,lng:125.0035}],
      baseElevation:0, height:15, color:'#1C6BEB', aliases:[], metadata:{} },
  ],
  components: [], nodes: [], edges: [], traces: [],
}

async function run() {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'], slowMo: 150 })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies([{ name: 'navi-mock-session', value: encoded, url: BASE }])
  const page = await context.newPage()

  const pageErrors = [], consoleErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  await page.goto(BASE + `/studio/${MAP_ID}/edit`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(({ campusMaps, graphSnapshot, MAP_ID }) => {
    localStorage.setItem('navi-campus-maps', JSON.stringify(campusMaps))
    localStorage.setItem(`navi-graph-${MAP_ID}`, JSON.stringify(graphSnapshot))
  }, { campusMaps, graphSnapshot, MAP_ID })
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(5000)

  let mapOk = false
  try { await page.waitForSelector('.maplibregl-map canvas', { timeout: 12000 }); mapOk = true } catch {}

  // Click each campus toolbar tool — should NOT throw "Unknown tool"
  const toolErrors = []
  for (const t of ['select', 'pan', 'draw-road', 'draw-building']) {
    const before = pageErrors.length
    await page.getByTitle(t === 'draw-road' ? 'Route' : t === 'draw-building' ? 'Building' : t[0].toUpperCase() + t.slice(1)).click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(400)
    if (pageErrors.length > before) toolErrors.push(`${t}: ${pageErrors[pageErrors.length - 1]}`)
  }

  // Inspect the buildings source on the live map
  const mapState = await page.evaluate(() => {
    const m = window.__naviMap
    if (!m) return { hasMap: false }
    const src = m.getSource('s-buildings')
    const features = src ? (src.serialize().data.features.length) : -1
    const rendered = m.queryRenderedFeatures({ layers: ['l-buildings-outline'] }).length
    // Did the initial view animate (flyTo) or jump? We can't easily detect post-hoc; report center.
    return { hasMap: true, buildingFeatures: features, renderedOutlineFeatures: rendered, center: m.getCenter() }
  })

  await page.screenshot({ path: 'e2e-shot-fixes.png', fullPage: false })

  console.log('=== VERIFY FIXES (headed) ===')
  console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE')
  console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE')
  console.log('Map canvas:', mapOk)
  console.log('Toolbar tool click errors:', toolErrors.length ? toolErrors : 'NONE')
  console.log('Map state:', JSON.stringify(mapState))
  console.log('Screenshot: e2e-shot-fixes.png')
  await browser.close()
}
run().catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(1) })
