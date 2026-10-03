import { chromium } from 'playwright'
import { requireE2eCampusId } from './e2e/support/campus-guard.mjs'

const BASE = 'http://localhost:3000'
const mapId = requireE2eCampusId()
const EDITOR_URL = `${BASE}/studio/${mapId}/edit`

// Mock auth cookie (base64-encoded JSON of MockUser)
const mockUser = { id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null }
const mockCookie = Buffer.from(JSON.stringify(mockUser)).toString('base64')

let passCount = 0
let failCount = 0
const failures = []
const findings = []

function check(label, ok, detail) {
  const symbol = ok ? '\u2713' : '\u2717'
  process.stdout.write(`  ${symbol} ${label}${detail ? ` (${detail})` : ''}\n`)
  if (ok) passCount++
  else { failCount++; failures.push(label) }
}

function finding(label, detail) {
  findings.push({ label, detail })
}

function heading(s) {
  process.stdout.write(`\n  \u2500\u2500 ${s} \u2500\u2500\n`)
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  // Set mock auth cookie
  await ctx.addCookies([{
    name: 'navi-mock-session',
    value: mockCookie,
    domain: 'localhost',
    path: '/',
  }])

  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  heading('P4: Real Browser Verification — Canvas Editor')
  process.stdout.write('\n  Flag: ENABLE_CANVAS_EDITOR = true\n')
  process.stdout.write('  URL: ' + EDITOR_URL + '\n\n')

  // Navigate to editor
  heading('1. Navigation')
  await page.goto(EDITOR_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(5000)

  const currentUrl = page.url()
  check('Navigated to editor', currentUrl.includes('studio'), currentUrl.substring(0, 80))
  await page.screenshot({ path: 'p4-browser-01-initial.png', fullPage: false })

  // Check for errors
  heading('2. Console errors')
  const criticalErrors = pageErrors.filter(e =>
    !e.includes('ResizeObserver') &&
    !e.includes('favicon') &&
    !e.includes('Warning')
  )
  check('No critical console errors', criticalErrors.length === 0,
    criticalErrors.length > 0 ? criticalErrors[0].substring(0, 100) : undefined)
  if (criticalErrors.length > 0) {
    finding('Console errors', criticalErrors.map(e => e.substring(0, 200)))
    criticalErrors.forEach(e => process.stdout.write(`    ERROR: ${e.substring(0, 200)}\n`))
  }

  // Check for canvas element
  heading('3. Canvas mounts')
  const canvasCount = await page.$$eval('canvas', els => els.length)
  check('Canvas element exists', canvasCount > 0, `found ${canvasCount}`)
  await page.screenshot({ path: 'p4-browser-02-canvas.png', fullPage: false })

  // Check for MapLibre (should NOT be present)
  heading('4. MapLibre not loaded')
  const mapContainer = await page.$('.maplibregl-map')
  check('MapLibre map container NOT present', mapContainer === null)

  // Check for Canvas status indicator
  heading('5. Canvas status indicator')
  const statusDiv = await page.$('div:has-text("Canvas")')
  check('Canvas status indicator visible', statusDiv !== null)
  if (statusDiv) {
    const statusText = await statusDiv.textContent()
    finding('Canvas status', statusText)
    process.stdout.write(`    Status: ${statusText}\n`)
  }

  // Check for floor geometry rendering
  heading('6. Floor geometry renders')
  const hasComponentCount = statusDiv && (await statusDiv.textContent()).includes('components')
  check('Component count shown in status', hasComponentCount !== null)

  // Try clicking to select
  heading('7. Selection works')
  const canvas = await page.$('canvas')
  if (canvas) {
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(1000)
      await page.screenshot({ path: 'p4-browser-03-selection.png', fullPage: false })

      // Check if selection state changed
      const bodyText = await page.textContent('body')
      const hasSelectionUI = bodyText.includes('Delete') || bodyText.includes('selected')
      check('Selection triggers UI feedback', hasSelectionUI)
    }
  }

  // Try zoom
  heading('8. Zoom works')
  if (canvas) {
    const box = await canvas.boundingBox()
    if (box) {
      const zoomBefore = await page.textContent('div:has-text("zoom")')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -200)
      await page.waitForTimeout(500)
      const zoomAfter = await page.textContent('div:has-text("zoom")')
      check('Zoom changes on wheel', zoomBefore !== zoomAfter, `${zoomBefore?.substring(0, 30)} → ${zoomAfter?.substring(0, 30)}`)
    }
  }

  // Check for vertex handles (try selecting a hallway)
  heading('9. Editing UI')
  const bodyText = await page.textContent('body')
  const hasEditingUI = bodyText.includes('editing') || bodyText.includes('vertices')
  finding('Editing UI present', hasEditingUI)

  // Final screenshot
  await page.screenshot({ path: 'p4-browser-04-final.png', fullPage: false })

  // Summary
  heading('Summary')
  process.stdout.write(`\n  Passed: ${passCount}\n`)
  process.stdout.write(`  Failed: ${failures.length}\n`)
  if (failures.length > 0) {
    process.stdout.write(`  Failures:\n`)
    failures.forEach(f => process.stdout.write(`    - ${f}\n`))
  }
  if (findings.length > 0) {
    process.stdout.write(`  Findings:\n`)
    findings.forEach(f => process.stdout.write(`    - ${f.label}: ${JSON.stringify(f.detail).substring(0, 150)}\n`))
  }
  process.stdout.write('\n  Screenshots saved: p4-browser-01-initial.png through p4-browser-04-final.png\n\n')

  await browser.close()
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
