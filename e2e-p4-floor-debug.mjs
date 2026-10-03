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
p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

const url = `http://localhost:3000/studio/${mapId}/edit/building/bld-1/floor/0`
console.log('Navigating to:', url)
await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(5000)

await p.screenshot({ path: 'p4-floor-debug.png', fullPage: true })
console.log('Screenshot saved: p4-floor-debug.png')

const hasCanvas = await p.$$eval('canvas', els => els.length)
const hasMapLibre = await p.$eval('.maplibregl-map', () => true).catch(() => false)
console.log('Canvas:', hasCanvas)
console.log('MapLibre:', hasMapLibre)
console.log('URL:', p.url())
console.log('Errors:', errors.length)
errors.forEach(e => console.log('  ERR:', e.substring(0, 200)))

const body = await p.textContent('body')
console.log('Body (first 500):', body?.substring(0, 500))

// Check for any error boundaries
const errorBoundary = await p.$('text=Error')
console.log('Error boundary visible:', errorBoundary !== null)

await b.close()
