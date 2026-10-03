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

const pageErrors = []
const consoleErrors = []
page.on('pageerror', (err) => pageErrors.push(err.message))
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

await page.goto(BASE + '/studio/map-1783994563934-02fbn/edit', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(5000)

// Wait for the map canvas to appear (Gate 0 success criterion)
let mapOk = false
try {
  await page.waitForSelector('.maplibregl-map canvas', { timeout: 10000 })
  mapOk = true
} catch { mapOk = false }

const state = await page.evaluate(() => ({
  canvas: document.querySelectorAll('canvas').length,
  mapDivs: document.querySelectorAll('.maplibregl-map').length,
  ctrl: document.querySelectorAll('.maplibregl-ctrl').length,
  hasToolbar: !!Array.from(document.querySelectorAll('*')).find(e => e.textContent === 'Publish' && e.tagName === 'BUTTON' || (e.tagName === 'BUTTON' && e.textContent?.includes('Publish'))),
  explorerText: document.body.innerText.includes('EXPLORER') || document.body.innerText.includes('Explorer'),
  workflowText: document.body.innerText.includes('Workflow'),
}))

console.log('=== GATE 0 VERIFICATION ===')
console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE')
console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE')
console.log('Map canvas rendered (.maplibregl-map canvas):', mapOk)
console.log('DOM:', JSON.stringify(state))
console.log('RESULT:', (pageErrors.length === 0 && consoleErrors.length === 0 && mapOk) ? 'PASS ✅' : 'FAIL ❌')

await browser.close()
