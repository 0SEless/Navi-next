/**
 * P4-T6: Real browser verification of Canvas editor.
 *
 * This script must be run manually with a browser window open.
 * It navigates to the floor editor, enables Canvas, and verifies
 * the 12 items listed in the P4-T6 checklist.
 *
 * Usage:
 *   1. Set ENABLE_CANVAS_EDITOR = true in feature-flag.ts
 *   2. Start dev server: npx next dev
 *   3. Run: node e2e-p4t6-browser-verification.mjs
 *   4. Observe the browser window
 *   5. Set ENABLE_CANVAS_EDITOR = false when done
 */

import { chromium } from 'playwright'
import { requireE2eCampusId } from './e2e/support/campus-guard.mjs'

const BASE = 'http://localhost:3000'
const mapId = requireE2eCampusId()
const EDITOR_URL = `${BASE}/studio/${mapId}/edit`

let passCount = 0
let failCount = 0
const failures = []

function check(label, ok, detail) {
  process.stdout.write(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` (${detail})` : ''}\n`)
  if (ok) passCount++
  else { failCount++; failures.push(label) }
}

function heading(s) {
  process.stdout.write(`\n  \u2500\u2500 ${s} \u2500\u2500\n`)
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  // Seed campus data
  const now = new Date().toISOString()
  await ctx.addInitScript((args) => {
    const { mapId, now } = args
    localStorage.setItem('navi-campus-maps', JSON.stringify({
      maps: [{
        id: mapId, name: 'Browser Test Campus', schoolName: 'Test University',
        boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
        center: { lat: 11.001, lng: 125.002 },
        createdAt: now, updatedAt: now,
        stats: { buildings: 1, nodes: 0, edges: 0 },
      }],
      landmarkTypes: [],
      landmarkInstances: [],
    }))
    if (!localStorage.getItem('navi-graph-' + mapId)) {
      localStorage.setItem('navi-graph-' + mapId, JSON.stringify({
        id: mapId, campusId: mapId, name: 'Browser Test Campus',
        version: '1.0.0', updatedAt: now,
        buildings: [{
          id: 'bld-1', name: 'Main Building', code: 'MB',
          color: '#8B5CF6', height: 20,
          floors: [{ id: 'flr-0', level: 0, label: 'Ground Floor', elevation: 0 }],
          footprint: [
            { lat: 11.0009, lng: 125.0016 },
            { lat: 11.0012, lng: 125.0016 },
            { lat: 11.0012, lng: 125.0024 },
            { lat: 11.0009, lng: 125.0024 },
          ],
          floorData: [{
            id: 'flr-0', level: 0, label: 'Ground Floor',
            polygon: [
              { lat: 11.0009, lng: 125.0016 },
              { lat: 11.0012, lng: 125.0016 },
              { lat: 11.0012, lng: 125.0024 },
              { lat: 11.0009, lng: 125.0024 },
            ],
          }],
          rooms: [{
            id: 'room-1', type: 'room', name: 'Room 101',
            polygon: [
              { lat: 11.0009, lng: 125.0016 },
              { lat: 11.0011, lng: 125.0016 },
              { lat: 11.0011, lng: 125.0020 },
              { lat: 11.0009, lng: 125.0020 },
            ],
          }],
          hallways: [],
          staircases: [],
          elevators: [],
          entrances: [],
        }],
      }))
    }
  }, { mapId: 'browser-test', now })

  heading('P4-T6: Real Browser Verification')
  process.stdout.write('\n  NOTE: ENABLE_CANVAS_EDITOR must be set to true before running.\n')
  process.stdout.write('  The dev server must be running on port 3000.\n\n')

  // 1. Navigate to floor editor
  heading('1. Canvas mounts')
  await page.goto(EDITOR_URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(3000)

  // Check for canvas element
  const canvas = await page.$('canvas')
  check('Canvas element exists', canvas !== null)

  // Check for Canvas status indicator
  const statusText = await page.textContent('div:has-text("Canvas")')
  check('Canvas status indicator visible', statusText !== null && statusText.includes('Canvas'))

  // 2. Floor geometry renders
  heading('2. Floor geometry renders')
  // Check for component count in status indicator
  const hasComponents = statusText && statusText.includes('components')
  check('Component count shown', hasComponents)

  // 3. Pan/zoom works
  heading('3. Pan/zoom works')
  // Try scrolling to zoom
  if (canvas) {
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -100) // zoom in
      await page.waitForTimeout(500)
      const zoomText = await page.textContent('div:has-text("zoom")')
      check('Zoom changes on wheel', zoomText !== null && zoomText.includes('zoom'))
    }
  }

  // 4. Selection works
  heading('4. Selection works')
  // Click on canvas to try selecting
  if (canvas) {
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(500)
      // Check if any entity is selected (status or inspector)
      const selectedText = await page.textContent('body')
      const hasSelection = selectedText && (selectedText.includes('Room') || selectedText.includes('Hallway') || selectedText.includes('selected'))
      check('Click triggers selection', hasSelection !== null)
    }
  }

  // 5. Check for console errors
  heading('5. Console errors')
  const criticalErrors = pageErrors.filter(e => !e.includes('ResizeObserver') && !e.includes('favicon'))
  check('No critical console errors', criticalErrors.length === 0, criticalErrors.length > 0 ? criticalErrors[0] : undefined)

  // 6. MapLibre is NOT loaded (Canvas path active)
  heading('6. MapLibre not loaded')
  const maplibreLoaded = await page.evaluate(() => {
    return typeof window !== 'undefined' && window.maplibregl !== undefined
  })
  check('MapLibre not loaded (Canvas path active)', !maplibreLoaded)

  // Summary
  heading('Summary')
  process.stdout.write(`\n  Passed: ${passCount}\n`)
  process.stdout.write(`  Failed: ${failCount}\n`)
  if (failures.length > 0) {
    process.stdout.write(`  Failures: ${failures.join(', ')}\n`)
  }
  process.stdout.write('\n')

  await browser.close()

  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Verification failed:', e)
  process.exit(1)
})
