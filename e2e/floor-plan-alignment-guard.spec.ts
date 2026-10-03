/**
 * Playwright test: Floor plan alignment guard (no crash without floor plan)
 *
 * Verifies clicking "Align Floor Plan" when no floor plan is uploaded
 * does not crash the editor (regression test for P2 crash bug).
 *
 * Run: npx playwright test e2e/floor-plan-alignment-guard.spec.ts --reporter=line
 */
import { test, expect } from '@playwright/test'

test.describe('Floor plan alignment guard', () => {
  test('align button does not crash when no floor plan uploaded', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text) })

    await page.goto('/studio/map-map-1-zwfg/edit/building/osm-bldg-801492090/floor/0')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // Verify floor editor loaded
    await expect(page.getByRole('button', { name: /Align Floor Plan/i })).toBeVisible()

    // Click align — before fix this crashed with "Cannot read properties of undefined (reading 'lng')"
    await page.getByRole('button', { name: /Align Floor Plan/i }).click()
    await page.waitForTimeout(500)

    // Verify no crash — align panel should NOT appear (no floor plan)
    const floorPlanPanel = page.locator('text=Floor Plan Alignment')
    await expect(floorPlanPanel).not.toBeVisible()

    // Allow only the pre-existing ImageSource decode error
    expect(pageErrors).toEqual([])
    const nonImageErrors = consoleErrors.filter(e => !e.includes('source image could not be decoded'))
    expect(nonImageErrors).toEqual([])

    console.log('PASS: Align button does not crash without floor plan')
  })
})
