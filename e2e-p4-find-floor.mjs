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

// Try direct navigation to floor editor with common building IDs
const buildingIds = ['bld-1', 'building-1', 'b1', 'Bldg No. 1', 'lib', 'library']
const floors = [0, 1, '0', '1']

console.log('=== Trying floor editor URLs ===\n')

for (const bid of buildingIds) {
  for (const floor of floors) {
    const url = `http://localhost:3000/studio/${mapId}/edit/building/${bid}/floor/${floor}`
    try {
      const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
      const status = resp?.status()
      if (status === 200) {
        console.log(`✓ ${url} → ${status}`)
        await p.waitForTimeout(3000)
        const hasCanvas = await p.$$eval('canvas', els => els.length)
        const currentUrl = p.url()
        console.log(`  Canvas: ${hasCanvas}, URL: ${currentUrl}`)
        await p.screenshot({ path: `p4-floor-${bid}-${floor}.png` })
        
        if (hasCanvas > 0) {
          const body = (await p.textContent('body'))?.substring(0, 300)
          console.log(`  Body: ${body}`)
          console.log('  ERRORS:', errors.length)
          errors.forEach(e => console.log('    ', e.substring(0, 150)))
          await b.close()
          process.exit(0)
        }
      }
    } catch (e) {
      // skip
    }
  }
}

console.log('\nNo floor editor found. Trying to extract building IDs from localStorage...')
  await p.goto(`http://localhost:3000/studio/${mapId}/edit`, { waitUntil: 'networkidle', timeout: 15000 })
await p.waitForTimeout(2000)
const stored = await p.evaluate(() => {
  const keys = Object.keys(localStorage).filter(k => k.includes('graph') || k.includes('building'))
  return keys.map(k => ({ key: k, value: localStorage.getItem(k)?.substring(0, 200) }))
})
stored.forEach(s => console.log(`  ${s.key}: ${s.value}`))

await b.close()
