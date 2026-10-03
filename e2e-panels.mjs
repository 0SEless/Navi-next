import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const user = { id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null }
const encoded = Buffer.from(JSON.stringify(user)).toString('base64')

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addCookies([{ name: 'navi-mock-session', value: encoded, url: BASE }])
const page = await context.newPage()

await page.goto(BASE + '/studio/map-1783994563934-02fbn/edit', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(4000)

// Check for key panel markers by text content
const checks = {
  'Toolbar (Campus/Building/Floor tools)': ['Campus', 'Building', 'Floor', 'Select', 'Publish'],
  'Explorer panel': ['EXPLORER', 'No entities in document'],
  'Canvas (maplibre)': ['mapLibre', 'OpenStreetMap'],
  'Inspector/Properties (right panel)': ['Properties', 'Select an entity', 'Inspector'],
  'Editor context OK (no useEditor crash)': [],
}

for (const [label, markers] of Object.entries(checks)) {
  let found = []
  for (const m of markers) {
    const count = await page.getByText(m, { exact: false }).count()
    if (count > 0) found.push(`${m}(${count})`)
  }
  const status = markers.length === 0 ? 'n/a' : (found.length > 0 ? 'OK' : 'MISSING')
  console.log(`[${status}] ${label}` + (found.length ? ` -> ${found.join(', ')}` : ''))
}

// Look for canvas element (maplibre canvas)
const canvasCount = await page.locator('canvas').count()
console.log(`\nCanvas elements found: ${canvasCount}`)

// Look for the right-hand properties panel (width 280 in source)
const divs = await page.locator('div').count()
console.log(`Total div count: ${divs}`)

await browser.close()
console.log('\nDONE')
