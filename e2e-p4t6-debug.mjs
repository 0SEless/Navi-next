import { chromium } from 'playwright'
import { requireE2eCampusId } from './e2e/support/campus-guard.mjs'

const BASE = 'http://localhost:3000'
const mapId = requireE2eCampusId()
const EDITOR_URL = `${BASE}/studio/${mapId}/edit`

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text())
  })

  process.stdout.write('\n  Navigating to editor...\n')
  await page.goto(EDITOR_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(5000)

  // Take screenshot
  await page.screenshot({ path: 'p4t6-browser-screenshot.png', fullPage: true })
  process.stdout.write('  Screenshot saved: p4t6-browser-screenshot.png\n')

  // Check page content
  const title = await page.title()
  process.stdout.write(`  Page title: ${title}\n`)

  const url = page.url()
  process.stdout.write(`  Current URL: ${url}\n`)

  // Check for canvas
  const canvasCount = await page.$$eval('canvas', els => els.length)
  process.stdout.write(`  Canvas elements found: ${canvasCount}\n`)

  // Check for MapLibre map container
  const mapContainer = await page.$('.maplibregl-map')
  process.stdout.write(`  MapLibre map container found: ${mapContainer !== null}\n`)

  // Check for any div with "Canvas" text
  const canvasDivs = await page.$$eval('div', els =>
    els.filter(el => el.textContent?.includes('Canvas')).map(el => el.textContent?.substring(0, 100))
  )
  process.stdout.write(`  Divs containing "Canvas": ${canvasDivs.length}\n`)
  if (canvasDivs.length > 0) {
    canvasDivs.forEach((t, i) => process.stdout.write(`    [${i}] ${t}\n`))
  }

  // Check for errors
  process.stdout.write(`\n  Console errors: ${pageErrors.length}\n`)
  pageErrors.forEach((e, i) => process.stdout.write(`    [${i}] ${e.substring(0, 200)}\n`))

  // Check what's on the page
  const bodyText = await page.textContent('body')
  const bodyPreview = bodyText?.substring(0, 500)
  process.stdout.write(`\n  Body text preview:\n  ${bodyPreview}\n`)

  await browser.close()
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
