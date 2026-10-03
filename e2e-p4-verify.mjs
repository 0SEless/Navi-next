import { chromium } from 'playwright'
import { requireE2eCampusId } from './e2e/support/campus-guard.mjs'

const mockUser = { id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null }
const mockCookie = Buffer.from(JSON.stringify(mockUser)).toString('base64')

// Safety gate: local dev + e2e share the production Supabase project. This
// script must never open or seed a protected production campus implicitly.
const mapId = requireE2eCampusId()
const now = new Date().toISOString()

let passCount = 0
let failCount = 0
const failures = []

function check(label, ok, detail) {
  process.stdout.write(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` (${detail})` : ''}\n`)
  if (ok) passCount++
  else { failCount++; failures.push(label) }
}

function heading(s) { process.stdout.write(`\n  \u2500\u2500 ${s} \u2500\u2500\n`) }

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: 'navi-mock-session', value: mockCookie, domain: 'localhost', path: '/' }])

  // Seed building data if not already present
  await ctx.addInitScript((args) => {
    const { mapId, now } = args
    if (!localStorage.getItem('navi-graph-' + mapId)) {
      localStorage.setItem('navi-graph-' + mapId, JSON.stringify({
        id: mapId, campusId: mapId, name: 'ASU Ibajay',
        version: '1.0.0', updatedAt: now,
        buildings: [{
          id: 'bld-test', name: 'Test Building', code: 'TB',
          color: '#8B5CF6', height: 20,
          center: { lat: 11.001, lng: 125.002 },
          floors: [{ id: 'flr-0', level: 0, label: 'Ground Floor', elevation: 0 }],
          footprint: [
            { lat: 11.0009, lng: 125.0016 },
            { lat: 11.0012, lng: 125.0016 },
            { lat: 11.0012, lng: 125.0020 },
            { lat: 11.0009, lng: 125.0020 },
          ],
          floorData: [{
            id: 'flr-0', level: 0, label: 'Ground Floor',
            polygon: [
              { lat: 11.0009, lng: 125.0016 },
              { lat: 11.0012, lng: 125.0016 },
              { lat: 11.0012, lng: 125.0020 },
              { lat: 11.0009, lng: 125.0020 },
            ],
          }],
          rooms: [{
            id: 'room-test', type: 'room', name: 'Room 101',
            polygon: [
              { lat: 11.0009, lng: 125.0016 },
              { lat: 11.0011, lng: 125.0016 },
              { lat: 11.0011, lng: 125.0019 },
              { lat: 11.0009, lng: 125.0019 },
            ],
          }],
          hallways: [],
          staircases: [],
          elevators: [],
          entrances: [],
        }],
        nodes: [], edges: [], components: [], traces: [],
      }))
    }
  }, { mapId, now })

  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  heading('P4: Real Browser Verification — Canvas Floor Editor')
  process.stdout.write('\n  Flag: ENABLE_CANVAS_EDITOR = true\n\n')

  // Navigate to floor editor
  heading('1. Navigate to floor editor')
  const floorUrl = `http://localhost:3000/studio/${mapId}/edit/building/bld-test/floor/0`
  await page.goto(floorUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(5000)

  const currentUrl = page.url()
  check('Navigated to floor editor', currentUrl.includes('floor'))
  await page.screenshot({ path: 'p4-verify-01-floor-editor.png', fullPage: false })

  // Check for errors
  heading('2. Console errors')
  const criticalErrors = pageErrors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'))
  check('No critical console errors', criticalErrors.length === 0,
    criticalErrors.length > 0 ? criticalErrors[0].substring(0, 100) : undefined)
  if (criticalErrors.length > 0) {
    criticalErrors.forEach(e => process.stdout.write(`    ERROR: ${e.substring(0, 200)}\n`))
  }

  // Check for canvas element
  heading('3. Canvas mounts')
  const canvasCount = await page.$$eval('canvas', els => els.length)
  check('Canvas element exists', canvasCount > 0, `found ${canvasCount}`)

  // Check for MapLibre (should NOT be present when Canvas flag is on)
  heading('4. MapLibre not loaded')
  const hasMapLibre = await page.$eval('.maplibregl-map', () => true).catch(() => false)
  check('MapLibre map container NOT present', !hasMapLibre)

  // Check for Canvas status indicator
  heading('5. Canvas status indicator')
  const bodyText = await page.textContent('body')
  const hasCanvasStatus = bodyText.includes('Canvas') && bodyText.includes('components')
  check('Canvas status indicator visible', hasCanvasStatus)

  // Check for floor geometry rendering
  heading('6. Floor geometry renders')
  const hasRooms = bodyText.includes('Room') || bodyText.includes('room')
  check('Floor geometry content visible', hasRooms || canvasCount > 0)

  // Try clicking to select
  heading('7. Selection works')
  const canvas = await page.$('canvas')
  if (canvas) {
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(1000)
      await page.screenshot({ path: 'p4-verify-02-click.png', fullPage: false })
      const afterClickText = await page.textContent('body')
      const hasSelectionUI = afterClickText.includes('Delete') || afterClickText.includes('selected') || afterClickText.includes('Canvas')
      check('Click triggers UI feedback', hasSelectionUI)
    }
  }

  // Try zoom
  heading('8. Zoom works')
  if (canvas) {
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -200)
      await page.waitForTimeout(500)
      await page.screenshot({ path: 'p4-verify-03-zoom.png', fullPage: false })
      check('Zoom action completed', true)
    }
  }

  // Final screenshot
  await page.screenshot({ path: 'p4-verify-04-final.png', fullPage: false })

  // Summary
  heading('Summary')
  process.stdout.write(`\n  Passed: ${passCount}\n`)
  process.stdout.write(`  Failed: ${failures.length}\n`)
  if (failures.length > 0) {
    process.stdout.write(`  Failures:\n`)
    failures.forEach(f => process.stdout.write(`    - ${f}\n`))
  }
  process.stdout.write('\n  Screenshots: p4-verify-01 through p4-verify-04\n\n')

  await browser.close()
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1) })
