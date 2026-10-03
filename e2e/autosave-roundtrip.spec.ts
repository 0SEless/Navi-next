/**
 * Playwright smoke test: Autosave round-trip
 *
 * Tests: Login → Open campus editor → Edit → Autosave → Refresh → Verify
 *
 * Run: npx playwright test e2e/autosave-roundtrip.spec.ts --reporter=line
 */
import { test, expect } from '@playwright/test'
import { requireDisposableTestCampusId } from './support/safety'

const BASE = 'http://localhost:3000'

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  // Click "Dr. Admin" mock auth button — sets cookie + React state
  const adminBtn = page.getByRole('button', { name: /Dr\. Admin/i })
  await adminBtn.click()
  await page.waitForTimeout(500) // let React state update
  // Middleware redirect is server-side: trigger it by navigating to /dashboard
  await page.goto(`${BASE}/dashboard`)
  await page.waitForLoadState('networkidle')
  // Should now be authenticated on /dashboard
  await expect(page).toHaveURL(/\/dashboard/)
}

async function openCampusEditor(page: import('@playwright/test').Page) {
  // Never pick a campus implicitly: local dev + e2e share the production
  // Supabase project, and the only existing campus today is protected.
  // Create a disposable campus and pass its id explicitly.
  const campusId = requireDisposableTestCampusId()
  console.log('Using explicit E2E campus ID:', campusId)

  // Navigate directly to the editor
  await page.goto(`${BASE}/studio/${campusId}/edit`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000) // let EditorBridge + graph store initialize

  console.log('Editor URL:', page.url())
  expect(page.url()).toContain('/edit')
}

test.describe('Autosave round-trip', () => {
  test('edit persists after autosave and page refresh', async ({ page }) => {
    // ── Step 1: Login via mock auth ───────────────────────────
    await loginAsAdmin(page)
    console.log('Logged in. URL:', page.url())

    // ── Step 2: Navigate to studio and open a campus editor ───
    await openCampusEditor(page)
    await page.screenshot({ path: 'e2e/screenshots/02-editor-loaded.png', fullPage: true })

    // ── Step 3: Record initial localStorage state ─────────────
    const storageBefore = await page.evaluate(() => {
      const data: Record<string, number> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) {
          const val = localStorage.getItem(key)
          data[key] = val?.length ?? 0
        }
      }
      return data
    })
    console.log('localStorage before edit:', storageBefore)

    // ── Step 4: Make an edit via React fiber ───────────────────
    const editResult = await page.evaluate(() => {
      // Find the EditorContext by walking the React fiber tree.
      // EditorProvider passes { document, services } as context.value on the Provider.
      // Strategy: find ANY element with a fiber key, then walk the full tree.

      // Step 1: find a DOM element that has a React fiber key
      const allElements = document.querySelectorAll('*')
      let startEl: Element | null = null
      for (let i = 0; i < allElements.length; i++) {
        const keys = Object.keys(allElements[i])
        if (keys.some(k => k.startsWith('__reactFiber$'))) {
          startEl = allElements[i]
          break
        }
      }
      if (!startEl) return { success: false, error: 'No React fiber found on any DOM element' }

      const fiberKey = Object.keys(startEl).find(k => k.startsWith('__reactFiber$'))!
      let fiber = (startEl as any)[fiberKey]
      let ctx = null
      let depth = 0

      // Walk UP to root first, then DOWN to search breadth-first
      // Actually, let's just walk the entire tree from this fiber
      const visited = new Set()

      function walkFiber(f: any): void {
        if (!f || visited.has(f) || depth > 500) return
        visited.add(f)
        depth++

        // Check if this fiber is an EditorReactContext.Provider
        // Provider fibers have: type?._context === EditorReactContext && memoizedProps.value
        const val = f.memoizedProps?.value
        if (val && typeof val === 'object' && val.services && val.document) {
          ctx = val
          return
        }

        // Also check pendingProps
        const pval = f.pendingProps?.value
        if (pval && typeof pval === 'object' && pval.services && pval.document) {
          ctx = pval
          return
        }

        // Also check memoizedState chain (for useState/useRef patterns)
        let state = f.memoizedState
        let stateDepth = 0
        while (state && stateDepth < 20) {
          const sc = state.memoizedState
          if (sc?.current?.services && sc.current?.document) {
            ctx = sc.current
            return
          }
          state = state.next
          stateDepth++
        }

        if (ctx) return
        walkFiber(f.child)
        if (ctx) return
        walkFiber(f.sibling)
      }

      walkFiber(fiber)

      if (!ctx) return { success: false, error: `Could not find editor context (searched ${depth} fibers)` }

      const services = ctx.services
      const doc = ctx.document

      const dispatcher = services.get('dispatcher')
      const documentStore = services.get('documentStore')

      if (!dispatcher) return { success: false, error: 'No dispatcher service' }
      if (!documentStore) return { success: false, error: 'No documentStore service' }

      const versionBefore = documentStore.version
      const buildingCountBefore = doc.buildings.length

      // Execute a building create command
      const result = dispatcher.execute({
        id: 'building.create',
        payload: {
          name: 'Playwright Test Building',
          footprint: { points: [
            { lat: 18.2, lng: 122.0 },
            { lat: 18.2, lng: 122.001 },
            { lat: 18.201, lng: 122.001 },
            { lat: 18.201, lng: 122.0 },
            { lat: 18.2, lng: 122.0 },
          ]},
        },
      })

      const versionAfter = documentStore.version
      const buildingCountAfter = doc.buildings.length

      return {
        success: result.success,
        error: result.error,
        entityId: result.entityId,
        versionBefore,
        versionAfter,
        versionChanged: versionAfter > versionBefore,
        buildingCountBefore,
        buildingCountAfter,
        buildingAdded: buildingCountAfter > buildingCountBefore,
      }
    })
    console.log('Edit result:', editResult)

    // The edit should have succeeded
    expect(editResult.success).toBe(true)
    expect(editResult.versionChanged).toBe(true)
    expect(editResult.buildingAdded).toBe(true)

    // ── Step 5: Wait for autosave (5s debounce + buffer) ──────
    console.log('Waiting 8 seconds for autosave...')
    await page.waitForTimeout(8000)

    // Check localStorage after autosave
    const storageAfterSave = await page.evaluate(() => {
      const data: Record<string, number> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) {
          const val = localStorage.getItem(key)
          data[key] = val?.length ?? 0
        }
      }
      return data
    })
    console.log('localStorage after autosave:', storageAfterSave)

    // Verify localStorage grew (data was saved)
    const totalBefore = Object.values(storageBefore).reduce((a, b) => a + b, 0)
    const totalAfter = Object.values(storageAfterSave).reduce((a, b) => a + b, 0)
    console.log(`localStorage bytes: before=${totalBefore}, after=${totalAfter}`)
    expect(totalAfter).toBeGreaterThanOrEqual(totalBefore)

    await page.screenshot({ path: 'e2e/screenshots/03-before-refresh.png', fullPage: true })

    // ── Step 6: Remember the edit URL and refresh ──────────────
    const editUrl = page.url()
    console.log('Edit URL before refresh:', editUrl)
    expect(editUrl).toContain('/edit')

    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: 'e2e/screenshots/04-after-refresh.png', fullPage: true })

    // ── Step 7: Verify the building persisted ─────────────────
    const verifyResult = await page.evaluate(() => {
      // Same fiber search as step 4
      const allElements = document.querySelectorAll('*')
      let startEl: Element | null = null
      for (let i = 0; i < allElements.length; i++) {
        const keys = Object.keys(allElements[i])
        if (keys.some(k => k.startsWith('__reactFiber$'))) {
          startEl = allElements[i]
          break
        }
      }
      if (!startEl) return { success: false, error: 'No React fiber found' }

      const fiberKey = Object.keys(startEl).find(k => k.startsWith('__reactFiber$'))!
      let fiber = (startEl as any)[fiberKey]
      let ctx = null
      let depth = 0
      const visited = new Set()

      function walkFiber(f: any): void {
        if (!f || visited.has(f) || depth > 500) return
        visited.add(f)
        depth++

        const val = f.memoizedProps?.value
        if (val && typeof val === 'object' && val.services && val.document) {
          ctx = val
          return
        }
        const pval = f.pendingProps?.value
        if (pval && typeof pval === 'object' && pval.services && pval.document) {
          ctx = pval
          return
        }
        let state = f.memoizedState
        let sd = 0
        while (state && sd < 20) {
          const sc = state.memoizedState
          if (sc?.current?.services && sc.current?.document) { ctx = sc.current; return }
          state = state.next; sd++
        }

        if (ctx) return
        walkFiber(f.child)
        if (ctx) return
        walkFiber(f.sibling)
      }

      walkFiber(fiber)
      if (!ctx) return { success: false, error: `Could not find editor context after refresh (searched ${depth} fibers)` }

      const doc = ctx.document
      const building = doc.buildings.find((b: any) => b.name === 'Playwright Test Building')

      return {
        success: true,
        buildingFound: !!building,
        buildingName: building?.name,
        buildingId: building?.id,
        totalBuildings: doc.buildings.length,
        allBuildingNames: doc.buildings.map((b: any) => b.name),
      }
    })
    console.log('Verify result after refresh:', verifyResult)

    // THE CRITICAL ASSERTION: The building should still exist after refresh
    expect(verifyResult.success).toBe(true)
    expect(verifyResult.buildingFound).toBe(true)
    expect(verifyResult.buildingName).toBe('Playwright Test Building')
    expect(verifyResult.totalBuildings).toBeGreaterThanOrEqual(1)

    console.log('✅ Autosave round-trip VERIFIED: edit persisted through autosave + refresh')
  })
})
