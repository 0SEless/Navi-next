import { requireSafeTestEnvironment } from '../e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const MAP_ID = 'map-1783994563934-02fbn'
const PAGES = [
  { name: 'preview', url: `${BASE}/studio/${MAP_ID}/preview` },
  { name: 'edit',    url: `${BASE}/studio/${MAP_ID}/edit` },
  { name: 'studio',  url: `${BASE}/studio` },
]

const browser = await chromium.launch({ headless: true })
const results = []

for (const { name, url } of PAGES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  const logs = []
  const warnings = []

  page.on('console', msg => {
    const t = msg.type()
    const text = msg.text()
    if (t === 'error') errors.push(`[CONSOLE_ERROR] ${text}`)
    else if (t === 'warning') warnings.push(`[WARN] ${text}`)
    else logs.push(`[${t}] ${text}`)
  })
  page.on('pageerror', err => errors.push(`[PAGE_CRASH] ${err.message}`))
  page.on('response', resp => {
    if (!resp.ok() && resp.status() !== 304) errors.push(`[HTTP ${resp.status()}] ${resp.url()}`)
  })

  // Navigate with domcontentloaded (fast), then wait for content
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(4000)
    // Try to wait for maplibre canvas or main content
    try {
      await page.waitForSelector('canvas, .maplibregl-canvas', { timeout: 5000 })
      await page.waitForTimeout(2000)
    } catch {
      // No canvas found, page might have loading state or error
    }
  } catch (e) {
    errors.push(`[NAV_FAIL] ${e.message}`)
  }

  // Screenshot
  let screenshotPath = `scripts/screenshot-${name}.png`
  try {
    await page.screenshot({ path: screenshotPath, timeout: 8000 })
  } catch (e) {
    errors.push(`[SCREENSHOT_FAIL] ${e.message}`)
    screenshotPath = null
  }

  results.push({
    name,
    url,
    screenshotPath,
    title: await page.title().catch(() => ''),
    errors,
    warnings,
    logs: logs.slice(-30), // keep last 30
  })

  await context.close()
}

await browser.close()

// Write all results
let output = ''
for (const r of results) {
  output += `\n=== ${r.name.toUpperCase()} ===\n`
  output += `URL: ${r.url}\n`
  output += `Title: ${r.title}\n`
  output += `Screenshot: ${r.screenshotPath}\n`
  if (r.errors.length) output += `\nERRORS (${r.errors.length}):\n${r.errors.join('\n')}\n`
  if (r.warnings.length) output += `\nWARNINGS (${r.warnings.length}):\n${r.warnings.join('\n')}\n`
  if (r.logs.length) output += `\nLOGS (last ${r.logs.length}):\n${r.logs.join('\n')}\n`
}
output += '\n=== SUMMARY ===\n'
for (const r of results) {
  output += `${r.name}: ${r.errors.length} errors, ${r.warnings.length} warnings\n`
}
writeFileSync('scripts/debug-report.txt', output)
console.log(output)
