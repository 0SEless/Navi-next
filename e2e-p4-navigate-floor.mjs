import { chromium } from 'playwright'
import { requireE2eCampusId } from './e2e/support/campus-guard.mjs'
const mockUser = { id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null }
const mockCookie = Buffer.from(JSON.stringify(mockUser)).toString('base64')
const mapId = requireE2eCampusId()

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([{ name: 'navi-mock-session', value: mockCookie, domain: 'localhost', path: '/' }])
const p = await ctx.newPage()
const errors = []
p.on('pageerror', e => errors.push(e.message))

// Navigate to studio first to find building IDs
console.log('=== Step 1: Navigate to studio ===')
await p.goto(`http://localhost:3000/studio/${mapId}/edit`, { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(3000)

// Get building IDs from the explorer
const buildingLinks = await p.$$eval('[data-testid*="building"], a[href*="building"]', els =>
  els.map(el => ({ text: el.textContent?.trim(), href: el.getAttribute('href') }))
).catch(() => [])
console.log('Building links found:', buildingLinks.length)
buildingLinks.slice(0, 3).forEach(b => console.log('  ', b))

// Try to find building IDs from the page
const allLinks = await p.$$eval('a', els =>
  els.filter(el => el.href.includes('building')).map(el => ({ text: el.textContent?.trim()?.substring(0, 50), href: el.href }))
).catch(() => [])
console.log('\nAll building links:', allLinks.length)
allLinks.slice(0, 5).forEach(l => console.log('  ', l))

// Try clicking on the first building to expand it
console.log('\n=== Step 2: Click first building ===')
const firstBuilding = await p.$('text=Bldg No. 1')
if (firstBuilding) {
  await firstBuilding.click()
  await p.waitForTimeout(2000)
  
  // Look for floor links
  const floorLinks = await p.$$eval('a', els =>
    els.filter(el => el.href.includes('floor')).map(el => ({ text: el.textContent?.trim()?.substring(0, 50), href: el.href }))
  ).catch(() => [])
  console.log('Floor links:', floorLinks.length)
  floorLinks.slice(0, 5).forEach(l => console.log('  ', l))
  
  // Try clicking on a floor
  if (floorLinks.length > 0) {
    const floorUrl = floorLinks[0].href
    console.log('\n=== Step 3: Navigate to floor editor ===')
    console.log('URL:', floorUrl)
    await p.goto(floorUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await p.waitForTimeout(5000)
    
    // Check what's on the page
    const hasCanvas = await p.$$eval('canvas', els => els.length)
    const hasMapLibre = await p.$eval('.maplibregl-map', () => true).catch(() => false)
    console.log('Canvas:', hasCanvas)
    console.log('MapLibre:', hasMapLibre)
    
    await p.screenshot({ path: 'p4-floor-editor.png' })
    console.log('Screenshot: p4-floor-editor.png')
    
    // Check body content
    const body = (await p.textContent('body'))?.substring(0, 500)
    console.log('Body:', body)
    
    // Check errors
    console.log('Errors:', errors.length)
    errors.forEach(e => console.log('  ERROR:', e.substring(0, 200)))
  }
}

await b.close()
