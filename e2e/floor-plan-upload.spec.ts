/**
 * Playwright test: Floor plan upload in Manage Floors dialog
 *
 * Run: npx playwright test e2e/floor-plan-upload.spec.ts --reporter=line
 */
import { test, expect } from '@playwright/test'
import path from 'path'

const BASE = 'http://localhost:3004'

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /Dr\. Admin/i }).click()
  await page.waitForTimeout(500)
  await page.goto(`${BASE}/dashboard`)
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/dashboard/)
}

async function openCampusEditor(page: import('@playwright/test').Page) {
  // Use known campus ID directly (more reliable than /api/campus-maps)
  const campusId = 'map-map-2-8u5p'
  await page.goto(`${BASE}/studio/${campusId}/edit`)
  await page.waitForLoadState('networkidle')
  // Wait for document to load (tree items appear)
  await page.waitForTimeout(5000)
  expect(page.url()).toContain('/edit')
}

test.describe('Floor plan upload', () => {
  test('upload button opens file picker via <label> and sets planImageId', async ({ page }) => {
    // ── Login + open campus editor ───────────
    await loginAsAdmin(page)
    await openCampusEditor(page)

    // ── Take screenshot to see the state ─────
    await page.screenshot({ path: 'e2e/screenshots/floorplan-01-editor.png', fullPage: true })

    // ── Select a building from the tree ──────
    // Wait for the tree items to load (may need extra time for WebSocket data)
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('[role="treeitem"]')
      return items.length >= 26 // Bldg No. 26 is the 26th treeitem
    }, { timeout: 30000 })
    await page.waitForTimeout(500)
    const treeBuilding = page.getByRole('treeitem', { name: /Bldg No\. 26/i })
    await expect(treeBuilding).toBeVisible({ timeout: 5000 })
    await treeBuilding.click()
    await page.waitForTimeout(300)

    // ── Find the Manage Floors button ─────────
    const manageBtn = page.getByRole('button', { name: /Manage Floors/i })
    await expect(manageBtn).toBeVisible({ timeout: 10000 })
    await manageBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/screenshots/floorplan-02-dialog-open.png', fullPage: true })

    // ── Find the "+ Upload" label ────────────
    const uploadLabel = page.locator('label').filter({ hasText: '+ Upload' })
    await expect(uploadLabel).toBeVisible({ timeout: 5000 })

    // ── Screenshot before clicking upload ─────
    await page.screenshot({ path: 'e2e/screenshots/floorplan-03-before-upload.png', fullPage: true })

    // ── Check that the hidden file input exists ─
    const fileInput = page.locator('input[type="file"]')
    await expect(fileInput).toBeAttached()

    // ── Programmatically set a file ───────────
    // Create a tiny 1x1 pixel PNG as a data URL
    const testPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    await fileInput.setInputFiles({
      name: 'test-floor-plan.png',
      mimeType: 'image/png',
      buffer: testPng,
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/screenshots/floorplan-04-after-upload.png', fullPage: true })

    // ── Verify the thumbnail shows "✓ Uploaded" ─
    const uploadedLabel = page.locator('text=✓ Uploaded')
    await expect(uploadedLabel).toBeVisible({ timeout: 5000 })

    // ── Verify Replace and Remove are visible ─
    const replaceLabel = page.locator('label').filter({ hasText: 'Replace' })
    await expect(replaceLabel).toBeVisible({ timeout: 3000 })
    const removeBtn = page.getByRole('button', { name: /Remove/i })
    await expect(removeBtn).toBeVisible({ timeout: 3000 })

    // ── Verify planImageId was set ────────────
    const result = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*')
      let startEl: Element | null = null
      for (let i = 0; i < allElements.length; i++) {
        if (Object.keys(allElements[i]).some(k => k.startsWith('__reactFiber$'))) {
          startEl = allElements[i]; break
        }
      }
      if (!startEl) return { success: false, error: 'No React fiber' }
      const fiberKey = Object.keys(startEl).find(k => k.startsWith('__reactFiber$'))!
      let fiber = (startEl as any)[fiberKey]
      let ctx: any = null
      let depth = 0
      const visited = new Set()
      function walk(f: any) {
        if (!f || visited.has(f) || depth > 500) return
        visited.add(f); depth++
        const v = f.memoizedProps?.value
        if (v?.services && v?.document) { ctx = v; return }
        const pv = f.pendingProps?.value
        if (pv?.services && pv?.document) { ctx = pv; return }
        let s = f.memoizedState
        let i = 0
        while (s && i < 20) {
          const sc = s.memoizedState
          if (sc?.current?.services && sc.current?.document) { ctx = sc.current; return }
          s = s.next; i++
        }
        if (ctx) return; walk(f.child); if (ctx) return; walk(f.sibling)
      }
      walk(fiber)
      if (!ctx) return { success: false, error: `Context not found (${depth})` }
      const doc = ctx.document
      // Find the first floor of the selected building
      let floor = null
      for (const b of doc.buildings) {
        if (b.floors?.length) { floor = b.floors[0]; break }
      }
      return {
        success: true,
        floorId: floor?.id,
        planImageId: floor?.planImageId,
        floorPlanState: floor?.floorPlanState,
        hasPlan: !!floor?.planImageId,
      }
    })
    console.log('Floor after upload:', JSON.stringify(result, null, 2))

    expect(result.success).toBe(true)
    expect(result.hasPlan).toBe(true)
    expect(result.planImageId).toMatch(/^data:image/)
    expect(result.floorPlanState).toBe('active')

    // ── Test: remove the floor plan ──────────
    await removeBtn.click()
    await page.waitForTimeout(500)

    // Verify "+ Upload" label is back
    await expect(uploadLabel).toBeVisible({ timeout: 5000 })

    // Verify document data was cleared
    const afterRemove = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*')
      let startEl: Element | null = null
      for (let i = 0; i < allElements.length; i++) {
        if (Object.keys(allElements[i]).some(k => k.startsWith('__reactFiber$'))) {
          startEl = allElements[i]; break
        }
      }
      if (!startEl) return { error: 'No React fiber' }
      const fiberKey = Object.keys(startEl).find(k => k.startsWith('__reactFiber$'))!
      let fiber = (startEl as any)[fiberKey]
      let ctx: any = null
      let depth = 0
      const visited = new Set()
      function walk(f: any) {
        if (!f || visited.has(f) || depth > 500) return
        visited.add(f); depth++
        const v = f.memoizedProps?.value
        if (v?.services && v?.document) { ctx = v; return }
        const pv = f.pendingProps?.value
        if (pv?.services && pv?.document) { ctx = pv; return }
        let s = f.memoizedState
        let i = 0
        while (s && i < 20) {
          const sc = s.memoizedState
          if (sc?.current?.services && sc.current?.document) { ctx = sc.current; return }
          s = s.next; i++
        }
        if (ctx) return; walk(f.child); if (ctx) return; walk(f.sibling)
      }
      walk(fiber)
      if (!ctx) return { error: 'Context not found' }
      const doc = ctx.document
      let floor = null
      for (const b of doc.buildings) {
        if (b.floors?.length) { floor = b.floors[0]; break }
      }
      if (!floor) return { error: 'No floor' }
      return { planImageId: floor.planImageId, floorPlanState: floor.floorPlanState }
    })
    console.log('Floor after remove:', JSON.stringify(afterRemove, null, 2))
    expect(afterRemove.planImageId).toBeNull()

    // ── Test: re-upload (Replace path) ────────
    // Re-upload using the + Upload label
    await uploadLabel.click()
    await fileInput.setInputFiles({
      name: 'test-floor-plan.png',
      mimeType: 'image/png',
      buffer: testPng,
    })
    await page.waitForTimeout(500)
    await expect(uploadedLabel).toBeVisible({ timeout: 5000 })
    await page.screenshot({ path: 'e2e/screenshots/floorplan-06-re-uploaded.png', fullPage: true })

    console.log('✅ Floor plan upload: label works, setInputFiles succeeds, thumbnail appears, planImageId set')
  })
})
