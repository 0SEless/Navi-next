import { chromium } from 'playwright'
import { requireE2eCampusId } from './e2e/support/campus-guard.mjs'
const mockUser = { id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null }
const mockCookie = Buffer.from(JSON.stringify(mockUser)).toString('base64')
const mapId = requireE2eCampusId()

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([{ name: 'navi-mock-session', value: mockCookie, domain: 'localhost', path: '/' }])
const p = await ctx.newPage()

// Navigate to studio to see building list
await p.goto(`http://localhost:3000/studio/${mapId}/edit`, { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(3000)

// Extract building data from localStorage
const buildingData = await p.evaluate(() => {
  const keys = Object.keys(localStorage)
  const graphKey = keys.find(k => k.includes('graph') && k.includes('map-map-1'))
  if (!graphKey) return null
  const graph = JSON.parse(localStorage.getItem(graphKey) || '{}')
  return graph.buildings?.map(b => ({ id: b.id, name: b.name, floors: b.floors?.map(f => f.level) }))
})
console.log('Buildings:', JSON.stringify(buildingData, null, 2))

if (buildingData && buildingData.length > 0) {
  const first = buildingData[0]
  console.log(`\nNavigating to building: ${first.id}, floor: ${first.floors?.[0] ?? 0}`)
  const url = `http://localhost:3000/studio/${mapId}/edit/building/${first.id}/floor/${first.floors?.[0] ?? 0}`
  console.log('URL:', url)
  
  await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(5000)
  
  const hasCanvas = await p.$$eval('canvas', els => els.length)
  const hasMapLibre = await p.$eval('.maplibregl-map', () => true).catch(() => false)
  console.log('Canvas:', hasCanvas)
  console.log('MapLibre:', hasMapLibre)
  console.log('URL:', p.url())
  
  const errors = []
  p.on('pageerror', e => errors.push(e.message))
  
  await p.screenshot({ path: 'p4-floor-editor-final.png', fullPage: false })
  console.log('Screenshot: p4-floor-editor-final.png')
  
  const body = (await p.textContent('body'))?.substring(0, 500)
  console.log('Body:', body)
}

await b.close()
