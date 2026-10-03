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

await p.goto(`http://localhost:3000/studio/${mapId}/edit`, { waitUntil: 'networkidle', timeout: 30000 })
await p.waitForTimeout(5000)

const hasCanvas = await p.$$eval('canvas', els => els.length)
const hasMapLibre = await p.$eval('.maplibregl-map', () => true).catch(() => false)
const bodySnippet = (await p.textContent('body'))?.substring(0, 500)

console.log('Canvas elements:', hasCanvas)
console.log('MapLibre present:', hasMapLibre)
console.log('Errors:', errors.length)
errors.forEach(e => console.log('  ERROR:', e.substring(0, 200)))
console.log('Body:', bodySnippet)

await p.screenshot({ path: 'p4-debug.png' })
console.log('Screenshot: p4-debug.png')
await b.close()
