import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const mapId = 'asu-ibajay'
const url = `http://localhost:3000/studio/${mapId}/edit`
const DEMO = join(process.cwd(), 'demo-output')

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const pngBuffer = Buffer.from(PNG_B64, 'base64')

const seedGraph = {
  id: mapId, name: 'Test Campus', center: { lat: 11.0008, lng: 125.0015 }, zoom: 16,
  buildings: [
    {
      id: 'b1', name: 'Building One', code: 'B1', color: '#1C6BEB', height: 30,
      floors: [0],
      footprint: [{ lat: 11.0009, lng: 125.0016 }, { lat: 11.0012, lng: 125.0016 }, { lat: 11.0012, lng: 125.0020 }, { lat: 11.0009, lng: 125.0020 }],
    },
  ],
  ways: [], nodes: [], levels: [], components: [], edges: [],
}
const seedCampus = {
  id: mapId, name: 'Test Campus', description: 'seeded',
  center: { lat: 11.0008, lng: 125.0015 }, zoom: 16,
  stats: { buildings: 1, floors: 0, rooms: 0, nodes: 0, edges: 0, components: 0 },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

const browser = await chromium.launch({ headless: false, args: ['--window-size=1400,900'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()

await page.route('**/api/graph', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }))
await page.route('**/api/campus-maps', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ maps: [seedCampus] }) }))
await page.addInitScript(({ gid, graph, campus }) => {
  if (!localStorage.getItem('navi-graph-' + gid)) localStorage.setItem('navi-graph-' + gid, JSON.stringify(graph))
  if (!localStorage.getItem('navi-campus-maps')) localStorage.setItem('navi-campus-maps', JSON.stringify([campus]))
}, { gid: mapId, graph: seedGraph, campus: seedCampus })

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))

console.log('=== P1.1 GATE 3 — Publishing ===')
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__naviDebug && window.__naviDebug.docBuildings > 0, null, { timeout: 20000 }).catch(() => {})

// Select building b1
await page.waitForSelector('text=Building One', { timeout: 10000 }).catch(() => {})
await page.click('text=Building One').catch(() => {})
await page.waitForTimeout(600)

// Upload a floor plan (ties Gate 2 -> Gate 3)
await page.waitForSelector('input[data-floorplan-level="0"]', { timeout: 8000 }).catch(() => {})
await page.setInputFiles('input[data-floorplan-level="0"]', { name: 'floor0.png', mimeType: 'image/png', buffer: pngBuffer })
await page.waitForTimeout(1500)

// Save (marks workflow saved so publish is allowed)
await page.click('button:has-text("Save")').catch(() => {})
await page.waitForTimeout(1500)

// Publish
await page.click('button:has-text("Publish")').catch(() => {})
await page.waitForFunction(() => {
  const s = window.__naviDebug
  return false
}, null, { timeout: 1 }).catch(() => {})
await page.waitForTimeout(3500)

const toolbarText = await page.evaluate(() => document.body.innerText)
const published = /Published/.test(toolbarText)
const feedbackOk = /Rev\s*\d+.*nodes.*edges/.test(toolbarText)

// Verify artifacts on disk (written by /api/publish)
let artifactsOk = false, manifestOk = false, floorPlanInArtifact = false, counts = null
try {
  const manifest = JSON.parse(readFileSync(join(DEMO, 'manifest.json'), 'utf-8'))
  manifestOk = !!(manifest.artifacts && manifest.artifacts.navigationGraph && manifest.artifacts.buildingIndex)
  const bi = JSON.parse(readFileSync(join(DEMO, 'building-index.json'), 'utf-8'))
  floorPlanInArtifact = !!(bi.buildings && bi.buildings[0] && bi.buildings[0].floorPlanUrls && Object.keys(bi.buildings[0].floorPlanUrls).length > 0)
  artifactsOk = existsSync(join(DEMO, 'navigation.graph.json')) && existsSync(join(DEMO, 'search.index.json')) && existsSync(join(DEMO, 'poi.json')) && existsSync(join(DEMO, 'building-index.json'))
} catch (e) { /* leave false */ }

await page.screenshot({ path: 'e2e-p1.1-gate3.png' })

console.log('Toolbar shows Published:', published)
console.log('Feedback (Rev/nodes/edges) shown:', feedbackOk)
console.log('All 4 artifacts written:', artifactsOk)
console.log('Manifest present + lists artifacts:', manifestOk)
console.log('building-index.json carries floorPlanUrls:', floorPlanInArtifact)
console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE')

const pass = published && feedbackOk && artifactsOk && manifestOk && floorPlanInArtifact && pageErrors.length === 0
console.log('GATE 3 PASS:', pass)
await browser.close()
process.exit(pass ? 0 : 1)
