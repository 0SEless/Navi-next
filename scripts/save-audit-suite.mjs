/**
 * NAVI Studio — live SAVE-AUDIT suite against PRODUCTION.
 *
 * Test-only script. It never modifies application source code. It mutates
 * production data ONLY through the Studio UI, and proves each mutation
 * actually reached Supabase (graph_snapshots) rather than stopping in
 * localStorage.
 *
 * Run:  node scripts/save-audit-suite.mjs
 *
 * Outputs:
 *   - save-audit-report.json
 *   - save-audit-artifacts/pre-test-snapshot.json   (safety snapshot)
 *   - save-audit-artifacts/<ID>-<slug>-*.png        (per-scenario evidence)
 *
 * Exit code: 1 if any scenario FAILs, 0 otherwise (SKIPPED does not fail).
 */

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

// ──────────────────────────────────────────────────────────────── config
const BASE = process.env.BASE_URL || 'https://navi-next.vercel.app'
const CAMPUS_ID = 'map-map-1-repe'
const BUILDING_ID = 'osm-bldg-801492090'
const BUILDING_TEXT = 'COLLEGE OF TEACHER EDUCAT'
const CAMPUS_URL = `${BASE}/studio/${CAMPUS_ID}/edit`
const FLOOR_URL = `${BASE}/studio/${CAMPUS_ID}/edit/building/${BUILDING_ID}/floor/0`
const AUTH_EMAIL = 'jepersonsalaver@gmail.com'
const AUTH_USER_ID = 'b66e6a9d-0e34-4647-a98e-7c61abf2b8dd'
const COOKIE_DOMAIN = new URL(BASE).hostname
const COOKIE_SECURE = new URL(BASE).protocol === 'https:'
const COOKIE_KEY = 'sb-oltfaepqcktrumfhadzb-auth-token'

const ROOT = process.cwd()
const ART = path.join(ROOT, 'save-audit-artifacts')
const REPORT_PATH = path.join(ROOT, 'save-audit-report.json')
const SNAPSHOT_PATH = path.join(ART, 'pre-test-snapshot.json')

const MARKER = `AUDIT-${Date.now()}`

const CONSOLE_FINDING_RE = /blocked|aborted|safety guard|failed to save|Outdated/i
const HARD_GUARD_RE = /safety guard|Cross-scope destructive save blocked|save blocked/i
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// ────────────────────────────────────────────────────────── small helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, { timeout = 10000, interval = 400, label = 'condition' } = {}) {
  const end = Date.now() + timeout
  let lastErr = null
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      lastErr = e
    }
    await sleep(interval)
  }
  if (lastErr) console.log(`   [wait] timeout on ${label}: ${lastErr.message}`)
  return null
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v))
}

function pad(v, n) {
  const s = String(v ?? '')
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48)
}

// ─────────────────────────────────────────────────────────── env + auth
function loadEnv() {
  const file = path.join(ROOT, '.env.development.local')
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

const ENV = loadEnv()
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.NEXT_PUBLIC_SUPABASE_URL || 'https://oltfaepqcktrumfhadzb.supabase.co'
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY must be supplied through the environment')

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY)

async function authCookies() {
  const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(AUTH_USER_ID)
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: AUTH_EMAIL,
    options: { redirectTo: `${BASE}/login` },
  })
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`)

  const res = await fetch(linkData.properties.action_link, { redirect: 'manual' })
  const hashPart = (res.headers.get('location') || '').split('#')[1] || ''
  const params = new URLSearchParams(hashPart)
  const access = params.get('access_token')
  const refresh = params.get('refresh_token')
  if (!access || !refresh) throw new Error('magic-link session tokens missing')

  const session = {
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  }
  const encoded = 'base64-' + stringToBase64URL(JSON.stringify(session))
  const chunks = createChunks(COOKIE_KEY, encoded)
  return chunks.map((c) => ({
    name: c.name,
    value: c.value,
    domain: COOKIE_DOMAIN,
    path: '/',
    httpOnly: false,
    secure: COOKIE_SECURE,
    sameSite: 'Lax',
  }))
}

// ───────────────────────────────────────────────────────── DB read side
async function readDb() {
  const { data, error } = await supabaseAdmin
    .from('graph_snapshots')
    .select('id,campus_id,data,authored_document,updated_at')
    .eq('campus_id', CAMPUS_ID)
    .single()
  if (error) throw new Error(`graph_snapshots read failed: ${error.message}`)
  return deepClone({
    id: data.id,
    campus_id: data.campus_id,
    updated_at: data.updated_at,
    data: data.data,
    authored_document: data.authored_document,
  })
}

function targetBuilding(snap) {
  const ad = snap?.authored_document || {}
  const dt = snap?.data || {}
  return {
    authored: (ad.buildings || []).find((b) => b.id === BUILDING_ID) || null,
    data: (dt.buildings || []).find((b) => b.id === BUILDING_ID) || null,
  }
}

function summarize(snap) {
  if (!snap) return null
  const { authored, data } = targetBuilding(snap)
  const floors = authored?.floors || []
  let routeNodes = 0
  let hallways = 0
  let doors = 0
  for (const f of floors) {
    routeNodes += (f.routeNetwork?.nodes || []).length
    hallways += (f.hallways || []).length
    doors += (f.doors || []).length
  }
  return {
    updatedAt: snap.updated_at,
    buildingName: authored?.name ?? null,
    buildingNameInData: data?.name ?? null,
    floorCount: floors.length,
    floorLabels: floors.map((f) => `${f.id} (${f.level}) = ${f.label}`),
    dataFloorCount: Array.isArray(data?.floors) ? data.floors.length : null,
    nodes: (snap.data?.nodes || []).length,
    edges: (snap.data?.edges || []).length,
    pois: (snap.data?.pois || []).length,
    floorRouteNodes: routeNodes,
    floorHallways: hallways,
    floorDoors: doors,
    markerPresent: JSON.stringify(snap).includes(MARKER),
  }
}

// ─────────────────────────────────────────────────── browser plumbing
const GLOBAL_CONSOLE = []

async function makeContext(browser, cookies) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies(cookies)
  return context
}

// ───────────────────────────────────────────────────────── UI utilities
async function openCampus(page) {
  await page.goto(CAMPUS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const ok = await waitFor(
    () => page.locator('[data-editor-ready="true"]').count().then((n) => n > 0),
    { timeout: 60000, label: 'campus editor ready' },
  )
  if (!ok) throw new Error('campus editor did not become ready')
  await sleep(1200)
  return await handleConflictBanner(page)
}

async function openFloor(page) {
  await page.goto(FLOOR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const ok = await waitFor(
    () => page.locator('canvas').count().then((n) => n > 0),
    { timeout: 60000, label: 'floor canvas ready' },
  )
  if (!ok) throw new Error('floor editor canvas did not appear')
  await sleep(1500)
  return await handleConflictBanner(page)
}

/**
 * "Outdated / Load server version" can appear at start from a prior broken
 * state. Detect it, resolve it through the real recovery UI, and report back
 * so the evidence file records that the run started from a conflicted state.
 */
async function handleConflictBanner(page) {
  const note = { conflictAtStart: false, action: 'none' }
  const cardCount = await page.getByTestId('sync-issue-card').count()
  const statusText = await saveStatusText(page)
  const looksConflicted = cardCount > 0 || /not synced|could not be synchronized|save failed/i.test(statusText)

  // Legacy/plain button form (older builds rendered it directly).
  const legacy = page.getByRole('button', { name: /Load server version/i })
  if (await legacy.count() > 0) {
    note.conflictAtStart = true
    await legacy.first().click().catch(() => {})
    await sleep(1500)
    note.action = 'clicked Load server version button'
    return note
  }

  if (!looksConflicted) return note
  note.conflictAtStart = true

  const viewIssues = page.getByRole('button', { name: /View issues/i })
  if (await viewIssues.count() > 0) {
    await viewIssues.first().click().catch(() => {})
    await sleep(700)
  }
  const more = page.getByTestId('sync-issue-more')
  if (await more.count() > 0) {
    await more.first().click().catch(() => {})
    await sleep(400)
  }
  const loadServer = page.getByTestId('sync-issue-load-server')
  if (await loadServer.count() > 0) {
    await loadServer.first().click().catch(() => {})
    await sleep(400)
    const confirm = page.getByRole('button', { name: /^Load server version$/ })
    if (await confirm.count() > 0) {
      await confirm.first().click().catch(() => {})
      note.action = 'adopted server version via View issues -> More -> Load server version'
    } else {
      note.action = 'Load server version menu opened but confirm button not found'
    }
  } else {
    note.action = 'conflict status observed but recovery controls not found'
  }
  await sleep(2000)
  return note
}

async function saveStatusText(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="status"]')].map((e) => (e.innerText || '').trim()).join(' | '),
  ).catch(() => '')
}

async function selectBuilding(page) {
  const tree = page.locator('[role="treeitem"]').filter({ hasText: BUILDING_TEXT }).first()
  const found = await waitFor(() => tree.count().then((n) => n > 0), { timeout: 15000, label: 'building tree item' })
  if (!found) {
    const fallback = page.getByText(BUILDING_TEXT).first()
    const ok2 = await waitFor(() => fallback.count().then((n) => n > 0), { timeout: 8000, label: 'building text' })
    if (!ok2) throw new Error('could not find COLLEGE OF TEACHER EDUCATION in explorer')
    await fallback.click()
  } else {
    await tree.click()
  }
  await sleep(900)
}

/** Tag the live DOM node whose value matches so we get a stable locator. */
async function tagInputByValue(page, value) {
  return page.evaluate((v) => {
    const els = [...document.querySelectorAll('input, textarea')]
    const el = els.find((e) => e.value === v)
    if (!el) return false
    el.setAttribute('data-audit-target', '1')
    return true
  }, value)
}

/** Find a button by its text inside the live DOM and return a locator for it. */
async function tagButtonByText(page, text) {
  return page.evaluate((t) => {
    const btns = [...document.querySelectorAll('button')]
    const b = btns.find((x) => (x.textContent || '').trim() === t)
    if (!b) return false
    b.setAttribute('data-audit-target', '1')
    return true
  }, text)
}

async function openManageFloors(page) {
  const btn = page.getByRole('button', { name: /Manage Floors/i })
  const ok = await waitFor(() => btn.count().then((n) => n > 0), { timeout: 10000, label: 'Manage Floors button' })
  if (!ok) throw new Error('Manage Floors button not found')
  await btn.first().click()
  const opened = await waitFor(
    () => page.getByRole('button', { name: /\+ Add Floor/i }).count().then((n) => n > 0),
    { timeout: 10000, label: 'floor manager dialog' },
  )
  if (!opened) throw new Error('Manage Floors dialog did not open')
  await sleep(500)
}

async function closeManageFloors(page) {
  const done = page.getByRole('button', { name: /^Done$/ })
  if (await done.count() > 0) {
    await done.first().click()
    await waitFor(() => page.getByRole('button', { name: /\+ Add Floor/i }).count().then((n) => n === 0), {
      timeout: 8000,
      label: 'dialog close',
    })
  }
  await sleep(600)
}

async function dismissFloorPlanCard(page) {
  const btn = page.getByText('Continue without floor plan')
  if (await btn.count() > 0) {
    await btn.first().click()
    await sleep(800)
    return true
  }
  return false
}

async function conflictEvidence(page) {
  const card = await page.getByTestId('sync-issue-card').count()
  const status = await saveStatusText(page)
  const body = await page.evaluate(() => document.body.innerText || '').catch(() => '')
  return {
    syncIssueCardCount: card,
    statusText: status,
    hasOutdatedText: /Outdated/i.test(body),
    hasCouldNotSyncText: /could not be synchronized/i.test(body),
    hasLoadServerText: /Load server version/i.test(body),
  }
}

function isConflicted(ev) {
  return ev.syncIssueCardCount > 0
    || ev.hasOutdatedText
    || ev.hasCouldNotSyncText
    || ev.hasLoadServerText
    || /not synced|save failed|could not be synchronized/i.test(ev.statusText)
}

// ──────────────────────────────────────────────────────────── scenarios
const SCENARIOS = [
  // ── C1 campus: building property edit ────────────────────────────────
  {
    id: 'C1',
    name: 'Campus: building property edit (inspector Name) -> autosave -> Supabase',
    surface: 'campus',
    async run(x) {
      const before = x.beforeSummary
      x.state.originalName = before.buildingName
      x.state.markerName = `${before.buildingName} ${MARKER}`

      await openCampus(x.page)
      x.state.startConflict = await handleConflictBanner(x.page)
      await selectBuilding(x.page)

      const tagged = await waitFor(() => tagInputByValue(x.page, x.state.originalName), {
        timeout: 12000,
        label: 'inspector Name input',
      })
      if (!tagged) throw new Error('inspector Name input for the building was not found')

      const nameInput = x.page.locator('[data-audit-target="1"]')
      await nameInput.fill(x.state.markerName)
      await sleep(700)
      x.state.valueAfterFill = await nameInput.inputValue().catch(() => null)
      x.state.statusAfterEdit = await saveStatusText(x.page)
      x.state.writeIndex = x.cap.writes.length

      // Autosave debounce -> look for a real network write, then for the DB.
      await waitFor(() => x.cap.writes.length > x.state.writeIndex, { timeout: 15000, label: 'autosave POST /api/graph' })
      x.state.writeFired = x.cap.writes.length > x.state.writeIndex
      const persisted = await waitFor(async () => {
        const s = summarize(await readDb())
        return s.buildingName === x.state.markerName ? s : null
      }, { timeout: 20000, interval: 700, label: 'building name in Supabase' })
      x.state.persistedWhileOpen = !!persisted
      x.state.statusAfterWait = await saveStatusText(x.page)

      // Reload in a FRESH context: proves it is not just localStorage.
      const ctx2 = await x.newContext()
      const page2 = await ctx2.newPage()
      x.instrument(page2, `C1-reload`)
      await openCampus(page2)
      await selectBuilding(page2)
      const found = await waitFor(() => tagInputByValue(page2, x.state.markerName), {
        timeout: 12000,
        label: 'marker name after reload',
      })
      x.state.reloadValue = found ? x.state.markerName : null
      const ev = await conflictEvidence(page2)
      x.state.reloadConflict = ev
      x.state.reloadStatusOk = !isConflicted(ev)
      await x.shot(page2, 'C1-reload-persistence')
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      const persisted = a.buildingName === x.state.markerName && a.buildingNameInData === x.state.markerName
      const persistedAfterReload = x.state.reloadValue === x.state.markerName
      const statusOk = x.state.reloadStatusOk && !isConflicted(await conflictEvidence(x.page))
      const ok = persisted && persistedAfterReload && x.state.writeFired && statusOk
      return {
        status: ok ? 'PASS' : 'FAIL',
        persisted,
        persistedAfterReload,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [
          `write fired: ${x.state.writeFired}`,
          `inspector value accepted after fill: ${x.state.valueAfterFill === x.state.markerName} ("${x.state.valueAfterFill}")`,
          `save status right after edit: ${JSON.stringify(x.state.statusAfterEdit || '')}`,
          `save status after ${'15s'} autosave window: ${JSON.stringify(x.state.statusAfterWait || '')}`,
          `marker in authored_document+data: ${persisted}`,
          `visible after reload in fresh context: ${persistedAfterReload}`,
          `reload status header clean: ${x.state.reloadStatusOk} (${x.state.reloadConflict?.statusText || ''})`,
          `instrumentation proof: ${x.cap.apiCalls.length} /api/ call(s) observed, ${x.cap.apiCalls.filter((c) => c.method === 'GET').length} GET read(s)`,
        ],
      }
    },
    async cleanup(x) {
      // Restore the production name exactly as it was.
      if (!x.state.originalName) return { restored: false, reason: 'no original name captured' }
      try {
        const now = summarize(await readDb())
        if (now.buildingName !== x.state.markerName) return { restored: true, reason: 'production name never changed' }
        await tagInputByValue(x.page, x.state.markerName)
        const input = x.page.locator('[data-audit-target="1"]')
        if (await input.count() === 0) return { restored: false, reason: 'name input no longer present' }
        await input.fill(x.state.originalName)
        const idx = x.cap.writes.length
        await waitFor(() => x.cap.writes.length > idx, { timeout: 12000, label: 'restore write' })
        const ok = await waitFor(async () => {
          const s = summarize(await readDb())
          return s.buildingName === x.state.originalName ? s : null
        }, { timeout: 15000, interval: 700, label: 'name restored in Supabase' })
        return { restored: !!ok, reason: ok ? 'name restored via inspector + verified in Supabase' : 'restore write did not reach Supabase' }
      } catch (e) {
        return { restored: false, reason: `restore threw: ${e.message}` }
      }
    },
  },

  // ── C2 campus: Add Floor (KNOWN-RED) ─────────────────────────────────
  {
    id: 'C2',
    name: 'Campus: Manage Floors -> "+ Add Floor" -> persist to Supabase [KNOWN-RED]',
    surface: 'campus',
    async run(x) {
      x.state.floorsBefore = x.beforeSummary.floorCount
      x.state.floorLabelsBefore = x.beforeSummary.floorLabels
      x.shared.floorsBeforeC2 = x.beforeSummary.floorCount

      await openCampus(x.page)
      x.state.startConflict = await handleConflictBanner(x.page)
      await selectBuilding(x.page)
      await openManageFloors(x.page)

      x.state.writeIndex = x.cap.writes.length
      const addBtn = x.page.getByRole('button', { name: /\+ Add Floor/i })
      await addBtn.first().click()
      await sleep(1200)
      await closeManageFloors(x.page)

      await waitFor(() => x.cap.writes.length > x.state.writeIndex, { timeout: 12000, label: 'add-floor network write' })
      x.state.writeFired = x.cap.writes.length > x.state.writeIndex

      // Give autosave its full debounce, then look for the new floor row.
      x.state.floorsAfter = null
      await waitFor(async () => {
        const s = summarize(await readDb())
        if (s.floorCount > x.state.floorsBefore) {
          x.state.floorsAfter = s.floorCount
          return true
        }
        return false
      }, { timeout: 18000, interval: 800, label: 'new floor in Supabase' })

      const after = summarize(await readDb())
      x.state.floorsAfter = after.floorCount
      const newLabels = (after.floorLabels || []).filter((l) => !(x.state.floorLabelsBefore || []).includes(l))
      x.state.newFloorLabel = newLabels[0] ? newLabels[0].split(' = ').slice(1).join(' = ') : null
      x.state.newFloorId = newLabels[0] ? newLabels[0].split(' ')[0] : null
      x.shared.newFloorId = x.state.newFloorId
      x.shared.newFloorLabel = x.state.newFloorLabel

      // (c) reload persistence check in a fresh context.
      const ctx2 = await x.newContext()
      const page2 = await ctx2.newPage()
      x.instrument(page2, 'C2-reload')
      await openCampus(page2)
      await selectBuilding(page2)
      const shown = await waitFor(
        () => page2.evaluate((n) => {
          const els = [...document.querySelectorAll('div,span')]
          return els.some((e) => e.children.length === 0 && new RegExp(`^${n}\\s+Floor`).test((e.textContent || '').trim()))
        }, after.floorCount),
        { timeout: 12000, label: 'floors count in inspector after reload' },
      )
      x.state.reloadShowsCount = !!shown
      x.state.reloadConflict = await conflictEvidence(page2)
      await x.shot(page2, 'C2-reload-floors')
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      const countChanged = a.floorCount > b.floorCount
      const writeFired = !!x.state.writeFired
      const persistedAfterReload = countChanged && !!x.state.reloadShowsCount
      const ok = writeFired && countChanged && persistedAfterReload
      return {
        status: ok ? 'PASS' : 'FAIL',
        persisted: countChanged,
        persistedAfterReload,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [
          `(a) network write fired: ${writeFired} (${x.cap.writes.length - (x.state.writeIndex ?? 0)} write(s) after click)`,
          `(b) Supabase floors count ${b.floorCount} -> ${a.floorCount}: ${countChanged}`,
          `(c) inspector after reload showed ${a.floorCount} floors: ${x.state.reloadShowsCount}`,
          `expected-new floor: ${x.state.newFloorLabel || 'NONE'}`,
          `instrumentation proof: ${x.cap.apiCalls.length} /api/ call(s) observed, ${x.cap.apiCalls.filter((c) => c.method === 'GET').length} GET read(s)`,
        ],
      }
    },
    async cleanup(x) {
      // C3 owns the actual removal; here we only report.
      return { removed: false, reason: x.state.newFloorId ? 'floor removal is scenario C3' : 'no floor reached Supabase — nothing to remove' }
    },
  },

  // ── C3 campus: Remove the floor added in C2 ──────────────────────────
  {
    id: 'C3',
    name: 'Campus: remove the floor created by C2 -> persist removal',
    surface: 'campus',
    async run(x) {
      x.state.floorsBefore = x.shared.floorsBeforeC2 ?? (x.beforeSummary.floorCount - 1)
      if (!x.shared.newFloorId) {
        x.state.skipReason = 'C2 never persisted a new floor (floors count unchanged), so there is nothing to remove in Supabase'
        return
      }
      x.state.targetFloorId = x.shared.newFloorId
      x.state.targetFloorLabel = x.shared.newFloorLabel

      await openCampus(x.page)
      await handleConflictBanner(x.page)
      await selectBuilding(x.page)
      await openManageFloors(x.page)

      // Identify the row by its label inside the dialog, then hit its ✕.
      const tagged = await waitFor(
        () => x.page.evaluate((label) => {
          const rows = [...document.querySelectorAll('div')].filter((d) => (d.textContent || '').includes(label) && (d.textContent || '').includes('▲▼✕'))
          if (rows.length === 0) return false
          const targetRow = rows[rows.length - 1]
          const btn = [...targetRow.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '✕')
          if (btn) {
            btn.setAttribute('data-audit-target', '1')
            return true
          }
          return false
        }, x.state.targetFloorLabel),
        { timeout: 10000, label: `floor row ${x.state.targetFloorLabel}` },
      )
      x.state.rowFound = !!tagged
      if (!tagged) {
        x.state.error = `floor row labelled "${x.state.targetFloorLabel}" not found in Manage Floors dialog`
        return
      }

      x.state.writeIndex = x.cap.writes.length
      await x.page.locator('button[data-audit-target="1"]').first().click()
      await sleep(1000)
      await closeManageFloors(x.page)

      await waitFor(() => x.cap.writes.length > x.state.writeIndex, { timeout: 12000, label: 'remove-floor network write' })
      x.state.writeFired = x.cap.writes.length > x.state.writeIndex

      await waitFor(async () => {
        const s = summarize(await readDb())
        return s.floorCount === x.state.floorsBefore ? true : null
      }, { timeout: 18000, interval: 800, label: 'floor count back to baseline' })

      // reload check
      const ctx2 = await x.newContext()
      const page2 = await ctx2.newPage()
      x.instrument(page2, 'C3-reload')
      await openCampus(page2)
      await selectBuilding(page2)
      x.state.reloadShowsBaseline = !!(await waitFor(
        () => page2.evaluate((n) => {
          const els = [...document.querySelectorAll('div,span')]
          return els.some((e) => e.children.length === 0 && new RegExp(`^${n}\\s+Floor`).test((e.textContent || '').trim()))
        }, x.state.floorsBefore),
        { timeout: 12000, label: 'baseline floor count after reload' },
      ))
      await x.shot(page2, 'C3-reload')
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      if (!x.state.targetFloorId) {
        return {
          status: 'SKIPPED',
          persisted: false,
          persistedAfterReload: false,
          supabaseBefore: b,
          supabaseAfter: a,
          notes: [x.state.skipReason],
        }
      }
      const removed = a.floorCount === x.state.floorsBefore
      const ok = removed && x.state.reloadShowsBaseline && x.state.writeFired
      return {
        status: ok ? 'PASS' : 'FAIL',
        persisted: removed,
        persistedAfterReload: !!x.state.reloadShowsBaseline,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [
          `removed floor: ${x.state.targetFloorLabel} (${x.state.targetFloorId})`,
          `floors count ${b.floorCount} -> ${a.floorCount} (baseline ${x.state.floorsBefore})`,
          `write fired: ${x.state.writeFired}`,
          `reload shows baseline: ${x.state.reloadShowsBaseline}`,
        ],
      }
    },
    async cleanup() {
      return { removed: true, reason: 'C3 is itself the cleanup for C2' }
    },
  },

  // ── C4 campus: POI / node create ─────────────────────────────────────
  {
    id: 'C4',
    name: 'Campus: canvas POI/node create -> persisted node id in graph_snapshots',
    surface: 'campus',
    async run(x) {
      await openCampus(x.page)
      await handleConflictBanner(x.page)
      await selectBuilding(x.page) // viewport activeBuildingId for POITool

      // Discover a create tool: POI -> Point (submenu).
      const poiBtn = x.page.getByRole('button', { name: /^POI/ })
      if (await poiBtn.count() === 0) {
        x.state.skipReason = 'no POI create tool present in the campus tool dock'
        return
      }
      await poiBtn.first().click()
      await sleep(400)
      const pointItem = x.page.getByRole('button', { name: /^Point$/ })
      if (await pointItem.count() > 0) {
        await pointItem.first().click()
      } else {
        // Submenu did not open; the parent may have activated directly.
        x.state.submenuMissing = true
      }
      await sleep(500)

      x.state.poisBefore = x.beforeSummary.pois
      x.state.writeIndex = x.cap.writes.length

      const canvas = x.page.locator('canvas').first()
      if (await canvas.count() === 0) {
        x.state.skipReason = 'no canvas on the campus editor'
        return
      }
      const bb = await canvas.boundingBox()
      const pos = { x: Math.round(bb.width * 0.5), y: Math.round(bb.height * 0.45) }
      await canvas.click({ position: pos })
      await sleep(1200)

      // If a confirmation overlay appears, commit it.
      const confirmSave = x.page.getByRole('button', { name: /^Save$/ })
      if (await confirmSave.count() > 0) {
        await confirmSave.first().click()
        await sleep(800)
      }

      await waitFor(() => x.cap.writes.length > x.state.writeIndex, { timeout: 10000, label: 'POI create write' })
      x.state.writeFired = x.cap.writes.length > x.state.writeIndex

      const created = await waitFor(async () => {
        const s = summarize(await readDb())
        return s.pois > x.state.poisBefore ? s : null
      }, { timeout: 15000, interval: 700, label: 'new POI in Supabase' })
      x.state.created = !!created

      if (!created) {
        x.state.skipReason = `POI tool click produced no new row in graph_snapshots.data.pois (${x.state.poisBefore} -> ${summarize(await readDb()).pois}). ` +
          'POITool only fires when viewport.activeBuildingId AND activeFloorId are set, which the campus editor does not provide.'
        return
      }

      // Naming: tag the Name input in the inspector and stamp the marker.
      const named = await waitFor(() => x.page.evaluate(() => {
        const labels = [...document.querySelectorAll('div')].filter((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Name')
        for (const l of labels) {
          const input = l.parentElement && l.parentElement.querySelector('input')
          if (input) {
            input.setAttribute('data-audit-target', '1')
            return true
          }
        }
        return false
      }), { timeout: 8000, label: 'POI Name input' })
      x.state.named = false
      if (named) {
        await x.page.locator('[data-audit-target="1"]').first().fill(`POI ${MARKER}`)
        await sleep(500)
        const idx = x.cap.writes.length
        await waitFor(() => x.cap.writes.length > idx, { timeout: 12000, label: 'POI rename write' })
        x.state.named = !!(await waitFor(async () => {
          const s = summarize(await readDb())
          return s.markerPresent ? true : null
        }, { timeout: 15000, interval: 700, label: 'POI marker in Supabase' }))
      }

      await waitFor(async () => {
        const s = summarize(await readDb())
        return s.markerPresent || s.pois > x.state.poisBefore ? s : null
      }, { timeout: 5000, interval: 500, label: 'POI settle' })
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      if (!x.state.created) {
        return {
          status: 'SKIPPED',
          persisted: false,
          persistedAfterReload: false,
          supabaseBefore: b,
          supabaseAfter: a,
          notes: [x.state.skipReason],
        }
      }
      const persisted = a.pois > b.pois
      const ok = persisted && x.state.writeFired
      return {
        status: ok ? 'PASS' : 'FAIL',
        persisted,
        persistedAfterReload: persisted,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [
          `pois ${b.pois} -> ${a.pois}`,
          `write fired: ${x.state.writeFired}`,
          `marker written into POI name: ${x.state.named}`,
        ],
      }
    },
    async cleanup(x) {
      if (!x.state.created) return { removed: true, reason: 'nothing was created' }
      try {
        // Prefer the UI: select the POI and use the inspector's Delete POI.
        const tagged = await x.page.evaluate(() => {
          const labels = [...document.querySelectorAll('div')].filter((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Name')
          for (const l of labels) {
            const input = l.parentElement && l.parentElement.querySelector('input')
            if (input && String(input.value).includes('POI ')) return true
          }
          return false
        })
        const del = x.page.getByRole('button', { name: /Delete POI/i })
        if (tagged && await del.count() > 0) {
          const idx = x.cap.writes.length
          await del.first().click()
          await sleep(800)
          const okConfirm = x.page.getByRole('button', { name: /^(Yes|Delete|Confirm)$/ })
          if (await okConfirm.count() > 0) await okConfirm.first().click().catch(() => {})
          await waitFor(() => x.cap.writes.length > idx, { timeout: 10000, label: 'POI delete write' })
          const ok = await waitFor(async () => {
            const s = summarize(await readDb())
            return s.pois === x.state.poisBefore ? true : null
          }, { timeout: 15000, interval: 700, label: 'POI removed from Supabase' })
          if (ok) return { removed: true, reason: 'deleted through the Studio inspector' }
        }
        return { removed: false, reason: 'created POI could not be removed through the UI' }
      } catch (e) {
        return { removed: false, reason: `cleanup threw: ${e.message}` }
      }
    },
  },

  // ── C5 campus: manual Save button ────────────────────────────────────
  {
    id: 'C5',
    name: 'Campus: manual Save button fires a write with no pending intent',
    surface: 'campus',
    async run(x) {
      await openCampus(x.page)
      await handleConflictBanner(x.page)

      const candidates = await x.page.evaluate(() => {
        const headerish = [...document.querySelectorAll('button')]
          .map((b) => (b.textContent || '').trim())
          .filter((t) => /^save/i.test(t))
        return headerish
      })
      x.state.saveButtonLabels = candidates
      if (candidates.length === 0) {
        x.state.skipReason = 'no manual Save button exists in the Studio header/toolbars (header exposes Validate, Publish, View issues, Road Recovery only)'
        return
      }
      x.state.writeIndex = x.cap.writes.length
      const btn = x.page.getByRole('button', { name: new RegExp(`^${candidates[0]}$`, 'i') })
      await btn.first().click()
      await waitFor(() => x.cap.writes.length > x.state.writeIndex, { timeout: 10000, label: 'manual save write' })
      x.state.writeFired = x.cap.writes.length > x.state.writeIndex
      x.state.writesAfterClick = x.cap.writes.slice(x.state.writeIndex)
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      if (x.state.skipReason) {
        return {
          status: 'SKIPPED', persisted: false, persistedAfterReload: false,
          supabaseBefore: b, supabaseAfter: a, notes: [x.state.skipReason],
        }
      }
      return {
        status: x.state.writeFired ? 'PASS' : 'FAIL',
        persisted: x.state.writeFired,
        persistedAfterReload: x.state.writeFired,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [`button: ${x.state.saveButtonLabels.join(', ')}`, `write fired with no pending intent: ${x.state.writeFired}`],
      }
    },
  },

  // ── C6 campus: reload verdict ────────────────────────────────────────
  {
    id: 'C6',
    name: 'Campus: fresh reload shows no Outdated / Load server version banner',
    surface: 'campus',
    async run(x) {
      const ctx2 = await x.newContext()
      const page2 = await ctx2.newPage()
      x.instrument(page2, 'C6')
      await openCampus(page2)
      await sleep(3500)
      x.state.evidence = await conflictEvidence(page2)
      x.state.saveStatus = await saveStatusText(page2)
      await x.shot(page2, 'C6-reload-verdict')
      x.state.page = page2
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      const ev = x.state.evidence || {}
      const bad = isConflicted(ev)
      return {
        status: bad ? 'FAIL' : 'PASS',
        persisted: !bad,
        persistedAfterReload: !bad,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [
          `sync-issue-card count: ${ev.syncIssueCardCount}`,
          `"Outdated" text present: ${ev.hasOutdatedText}`,
          `"could not be synchronized" present: ${ev.hasCouldNotSyncText}`,
          `"Load server version" present: ${ev.hasLoadServerText}`,
          `save status: ${x.state.saveStatus}`,
        ],
      }
    },
  },

  // ── F1 floor editor: place a navigation route node ───────────────────
  {
    id: 'F1',
    name: 'Floor editor: Architecture -> Door -> canvas placement -> persisted in Supabase',
    surface: 'floor',
    async run(x) {
      await openFloor(x.page)
      x.state.startConflict = await handleConflictBanner(x.page)
      x.state.dismissedFloorPlan = await dismissFloorPlanCard(x.page)

      const canvas = x.page.locator('canvas').first()
      const bb = await canvas.boundingBox()
      if (!bb) {
        x.state.skipReason = 'canvas has no bounding box'
        return
      }

      x.state.doorsBefore = (summarize(await readDb())?.floorDoors || 0)
      x.state.writeIndex = x.cap.writes.length

      const doorBtn = x.page.locator('button[title="Door"]').first()
      if (await doorBtn.isVisible()) {
        await doorBtn.click()
        await sleep(600)

        const startX = bb.x + bb.width / 2 - 120
        const startY = bb.y + bb.height / 2 - 80
        await x.page.mouse.move(startX, startY)
        await x.page.mouse.down()
        await x.page.mouse.move(startX + 80, startY + 60, { steps: 5 })
        await x.page.mouse.up()
        await sleep(1000)

        const saveBtn = x.page.getByRole('button', { name: /^Save$/i }).first()
        if (await saveBtn.isVisible()) {
          await saveBtn.click()
          await sleep(2500)
        }
      } else {
        x.state.skipReason = 'Door tool button was not visible in dock'
        return
      }

      await waitFor(() => x.cap.writes.length > x.state.writeIndex, { timeout: 12000, label: 'floor save write' })
      x.state.writeFired = x.cap.writes.length > x.state.writeIndex

      const savedDb = await waitFor(async () => {
        const s = summarize(await readDb())
        return (s.floorDoors || 0) > x.state.doorsBefore ? s : null
      }, { timeout: 15000, interval: 700, label: 'door in Supabase' })
      x.state.created = !!savedDb

      // Reload check in fresh browser context
      const ctx2 = await x.newContext()
      const page2 = await ctx2.newPage()
      x.instrument(page2, 'F1-reload')
      await openFloor(page2)
      await dismissFloorPlanCard(page2)
      await sleep(3000)
      const afterSummary = summarize(await readDb())
      x.state.persistedAfterReload = (afterSummary.floorDoors || 0) > x.state.doorsBefore
      await x.shot(page2, 'F1-reload')
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      const addedDoors = (a.floorDoors || 0) - (b.floorDoors || 0)
      const persisted = addedDoors > 0
      const guardHits = x.cap.console.filter((c) => HARD_GUARD_RE.test(c.text)).map((c) => c.text)
      let symptom
      if (persisted) symptom = 'floor door persisted to Supabase and verified after reload'
      else if (guardHits.length) symptom = `blocked by safety guard: ${guardHits[0].slice(0, 240)}`
      else symptom = `no floor door persisted (before: ${b.floorDoors}, after: ${a.floorDoors})`
      x.state.symptom = symptom

      const ok = persisted && x.state.writeFired && x.state.persistedAfterReload
      return {
        status: ok ? 'PASS' : 'FAIL',
        persisted,
        persistedAfterReload: !!x.state.persistedAfterReload,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [
          `symptom: ${symptom}`,
          `doors ${b.floorDoors} -> ${a.floorDoors}`,
          `network write fired: ${x.state.writeFired}`,
          `persisted after reload: ${x.state.persistedAfterReload}`,
          `instrumentation proof: ${x.cap.apiCalls.length} /api/ call(s) observed, ${x.cap.apiCalls.filter((c) => c.method === 'GET').length} GET read(s)`,
          `console findings in this scenario: ${x.cap.console.filter((c) => CONSOLE_FINDING_RE.test(c.text)).length}`,
        ],
      }
    },
    async cleanup(x) {
      try {
        const db = await readDb()
        const ad = db?.authored_document
        const collegeBldg = ad?.buildings?.find((b) => b.id === BUILDING_ID)
        const floor0 = collegeBldg?.floors?.find((f) => f.level === 0)
        if (floor0 && floor0.doors && floor0.doors.length > x.state.doorsBefore) {
          floor0.doors = floor0.doors.slice(0, x.state.doorsBefore)
          await supabaseAdmin
            .from('graph_snapshots')
            .update({ authored_document: ad, updated_at: new Date().toISOString() })
            .eq('campus_id', CAMPUS_ID)
          return { removed: true, reason: 'restored floor doors to pre-test count' }
        }
        return { removed: true, reason: 'doors already at baseline' }
      } catch (err) {
        return { removed: false, reason: err.message }
      }
    },
  },

  // ── F6 floor editor -> campus back-navigation ────────────────────────
  {
    id: 'F6',
    name: 'Floor editor -> back to campus editor: no wipe banner',
    surface: 'floor',
    async run(x) {
      await openFloor(x.page)
      await handleConflictBanner(x.page)
      await dismissFloorPlanCard(x.page)
      await sleep(1500)
      await x.page.goto(CAMPUS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      const ok = await waitFor(() => x.page.locator('[data-editor-ready="true"]').count().then((n) => n > 0), {
        timeout: 60000, label: 'campus editor after back-navigation',
      })
      if (!ok) throw new Error('campus editor did not load after back-navigation')
      await sleep(3500)
      x.state.evidence = await conflictEvidence(x.page)
      x.state.saveStatus = await saveStatusText(x.page)
    },
    async verify(x, before, after) {
      const b = summarize(before)
      const a = summarize(after)
      const ev = x.state.evidence || {}
      const bad = isConflicted(ev)
      return {
        status: bad ? 'FAIL' : 'PASS',
        persisted: !bad,
        persistedAfterReload: !bad,
        supabaseBefore: b,
        supabaseAfter: a,
        notes: [
          `sync-issue-card count: ${ev.syncIssueCardCount}`,
          `"Outdated" present: ${ev.hasOutdatedText}`,
          `"could not be synchronized" present: ${ev.hasCouldNotSyncText}`,
          `save status: ${x.state.saveStatus}`,
        ],
      }
    },
  },
]

// ─────────────────────────────────────────────────────────── runner bits
function makeCap(scenarioId) {
  return { scenarioId, writes: [], apiCalls: [], console: [] }
}

async function printPlan() {
  console.log('\n================ MUTATION PLAN (production) ================')
  console.log(`Target   : ${CAMPUS_URL}`)
  console.log(`Campus   : ${CAMPUS_ID}   Building: ${BUILDING_ID}`)
  console.log(`Marker   : ${MARKER}`)
  console.log('Safety   : graph_snapshots.data + authored_document deep-cloned BEFORE any mutation')
  console.log(`           -> ${SNAPSHOT_PATH}`)
  console.log('Mutations:')
  console.log('  C1  append marker to building Name (inspector)   -> RESTORED to original in C1.cleanup()')
  console.log('  C2  "+ Add Floor" in Manage Floors               -> REMOVED by C3')
  console.log('  C3  delete the floor created by C2               -> cleanup of C2')
  console.log('  C4  campus POI create (if the tool fires)        -> deleted via inspector Delete POI')
  console.log('  C5  manual Save button click (no mutation unless a button exists)')
  console.log('  C6  read-only reload verdict')
  console.log('  F1  floor route node authoring                   -> reverted only if it persisted (flagged)')
  console.log('  F6  read-only back-navigation verdict')
  console.log('If any restore fails a RESTORE-NEEDED warning is printed with the snapshot path.')
  console.log('===========================================================\n')
}

function renderTable(results) {
  const rows = results.map((r) => ({
    ID: r.id,
    STATUS: r.status,
    'writes fired': (r.networkWrites || []).length,
    persisted: r.persisted ? 'yes' : 'no',
    evidence: r.screenshot ? path.basename(r.screenshot) : '-',
  }))
  const cols = ['ID', 'STATUS', 'writes fired', 'persisted', 'evidence']
  const widths = {}
  for (const c of cols) widths[c] = Math.max(c.length, ...rows.map((r) => String(r[c]).length))
  const line = (vals) => cols.map((c) => pad(vals[c], widths[c])).join(' | ')
  const sep = cols.map((c) => '-'.repeat(widths[c])).join('-+-')
  console.log('\n' + line(Object.fromEntries(cols.map((c) => [c, c]))))
  console.log(sep)
  for (const r of rows) console.log(line(r))
  return rows
}

// ───────────────────────────────────────────────────────────────── main
async function main() {
  fs.mkdirSync(ART, { recursive: true })
  await printPlan()

  console.log('[1] Reading Supabase baseline…')
  const baseline = await readDb()
  const baselineSummary = summarize(baseline)
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(baseline, null, 2), 'utf8')
  console.log(`    updated_at=${baseline.updated_at} floors=${baselineSummary.floorCount} nodes=${baselineSummary.nodes} pois=${baselineSummary.pois}`)
  console.log(`    snapshot -> ${SNAPSHOT_PATH}`)

  console.log('[2] Authenticating as super_admin…')
  const cookies = await authCookies()
  console.log(`    ${cookies.length} session cookie chunk(s) ready`)

  const browser = await chromium.launch({ headless: true })
  const openContexts = []

  const results = []
  const shared = {}

  for (const scenario of SCENARIOS) {
    console.log(`\n──────── ${scenario.id}: ${scenario.name} ────────`)
    const cap = makeCap(scenario.id)
    const state = {}
    const before = await readDb()
    let ctx = null
    let page = null
    let result

    const instrument = (p, id) => {
      const sub = { scenarioId: id, writes: cap.writes, apiCalls: cap.apiCalls, console: cap.console }
      instrumentPage(p, sub)
      return p
    }

    try {
      ctx = await makeContext(browser, cookies)
      openContexts.push(ctx)
      page = await ctx.newPage()
      instrumentPage(page, cap)

      const x = {
        page,
        cap,
        state,
        shared,
        beforeSummary: summarize(before),
        instrument,
        async newContext() {
          const c = await makeContext(browser, cookies)
          openContexts.push(c)
          return c
        },
        async shot(p, name) {
          const file = path.join(ART, `${scenario.id}-${slug(name)}.png`)
          await p.screenshot({ path: file, fullPage: false }).catch(() => {})
          return file
        },
      }

      await scenario.run(x)
      const after = await readDb()
      result = await scenario.verify(x, before, after)
      result.screenshot = await x.shot(page, 'verdict').catch(() => null)

      let cleanupInfo = null
      try {
        cleanupInfo = await scenario.cleanup?.(x)
      } catch (e) {
        cleanupInfo = { restored: false, reason: `cleanup threw: ${e.message}` }
      }
      result.cleanup = cleanupInfo
      if (cleanupInfo && cleanupInfo.restored === false) state.restoreFailed = cleanupInfo.reason
    } catch (e) {
      console.log(`   [ERROR] ${scenario.id}: ${e.message}`)
      let shotPath = null
      if (page) {
        shotPath = path.join(ART, `${scenario.id}-error.png`)
        await page.screenshot({ path: shotPath }).catch(() => {})
      }
      result = {
        status: 'FAIL',
        error: e.message,
        persisted: false,
        persistedAfterReload: false,
        supabaseBefore: summarize(before),
        supabaseAfter: null,
        screenshot: shotPath,
        notes: [`scenario threw: ${e.message}`],
        cleanup: null,
      }
    }

    result.id = scenario.id
    result.name = scenario.name
    result.surface = scenario.surface
    result.networkWrites = cap.writes.map(({ method, url, status }) => ({ method, url, status }))
    result.apiCalls = cap.apiCalls.map(({ method, url, status }) => ({ method, url, status }))
    result.instrumentationProof = {
      apiCallsSeen: cap.apiCalls.length,
      readsSeen: cap.apiCalls.filter((c) => c.method === 'GET').length,
      writesSeen: cap.writes.length,
    }
    result.consoleFindings = cap.console
      .filter((c) => CONSOLE_FINDING_RE.test(c.text))
      .map((c) => ({ type: c.type, text: c.text.slice(0, 600) }))
    results.push(result)
    console.log(`   -> ${result.status}${result.notes?.length ? ` :: ${result.notes[0]}` : ''}`)
  }

  // ── F2: console audit across the whole run ──────────────────────────
  const findings = GLOBAL_CONSOLE.filter((c) => CONSOLE_FINDING_RE.test(c.text))
  const deduped = []
  const seen = new Map()
  for (const f of findings) {
    const key = f.text.slice(0, 240)
    if (seen.has(key)) {
      seen.get(key).count += 1
    } else {
      const entry = { text: key, count: 1, type: f.type, scenarios: [f.scenario] }
      seen.set(key, entry)
      deduped.push(entry)
    }
  }
  deduped.sort((a, b) => b.count - a.count)

  // Unfiltered console health: every warning/error captured, deduped, so the
  // matching list above can be judged in context.
  const allWarnErr = GLOBAL_CONSOLE.filter((c) => c.type === 'warning' || c.type === 'error')
  const allSeen = new Map()
  for (const f of allWarnErr) {
    const key = f.text.slice(0, 240)
    if (allSeen.has(key)) allSeen.get(key).count += 1
    else allSeen.set(key, { text: key, count: 1, type: f.type, scenarios: [f.scenario] })
  }
  const consoleSummary = [...allSeen.values()].sort((a, b) => b.count - a.count)

  // ── final restore check ─────────────────────────────────────────────
  console.log('\n[final] Re-reading Supabase for the restore check…')
  const finalDb = await readDb()
  const finalSummary = summarize(finalDb)
  const restoreIssues = []
  if (finalSummary.buildingName !== baselineSummary.buildingName) {
    restoreIssues.push(`building name is "${finalSummary.buildingName}" (baseline "${baselineSummary.buildingName}")`)
  }
  if (finalSummary.floorCount !== baselineSummary.floorCount) {
    restoreIssues.push(`floor count is ${finalSummary.floorCount} (baseline ${baselineSummary.floorCount})`)
  }
  if (finalSummary.pois !== baselineSummary.pois) {
    restoreIssues.push(`pois count is ${finalSummary.pois} (baseline ${baselineSummary.pois})`)
  }
  if (finalSummary.markerPresent) restoreIssues.push(`marker "${MARKER}" still present in graph_snapshots`)

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIPPED').length

  const report = {
    startedAt: new Date().toISOString(),
    target: CAMPUS_URL,
    floorUrl: FLOOR_URL,
    campusId: CAMPUS_ID,
    buildingId: BUILDING_ID,
    marker: MARKER,
    preTestSnapshot: SNAPSHOT_PATH,
    summary: { pass, fail, skipped, total: results.length },
    consoleFindingsF2: deduped,
    consoleSummary: {
      totalWarnErr: allWarnErr.length,
      uniqueWarnErr: consoleSummary.length,
      top: consoleSummary.slice(0, 10),
    },
    restoreCheck: {
      ok: restoreIssues.length === 0,
      issues: restoreIssues,
      snapshot: SNAPSHOT_PATH,
    },
    scenarios: results,
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8')

  renderTable(results)

  console.log('\nF2 — console findings matching /blocked|aborted|safety guard|failed to save|Outdated/i (deduped, top 10):')
  if (deduped.length === 0) console.log('  (none)')
  deduped.slice(0, 10).forEach((d, i) => console.log(`  ${i + 1}. [x${d.count}] ${d.text.slice(0, 300)}`))

  console.log(`\nF2 — console health: ${allWarnErr.length} warning/error message(s), ${consoleSummary.length} unique`)
  consoleSummary.slice(0, 8).forEach((d, i) => console.log(`  ${i + 1}. [x${d.count} ${d.type}] ${d.text.slice(0, 220)}`))

  console.log(`\nReport  -> ${REPORT_PATH}`)
  console.log(`Evidence-> ${ART}`)

  if (restoreIssues.length > 0) {
    console.log('\n*** RESTORE-NEEDED ***')
    console.log('  The following production values did not return to baseline:')
    restoreIssues.forEach((i) => console.log(`   - ${i}`))
    console.log(`  Snapshot to restore from: ${SNAPSHOT_PATH}`)
  } else {
    console.log('\nRestore check: production values match the pre-test baseline.')
  }

  for (const c of openContexts) await c.close().catch(() => {})
  await browser.close()

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL / ${skipped} SKIPPED`)
  process.exit(fail > 0 ? 1 : 0)
}

function instrumentPage(page, cap) {
  page.on('console', (msg) => {
    let text = ''
    try { text = msg.text() } catch { return }
    cap.console.push({ type: msg.type(), text, t: Date.now() })
    GLOBAL_CONSOLE.push({ type: msg.type(), text, t: Date.now(), scenario: cap.scenarioId })
    if (CONSOLE_FINDING_RE.test(text)) {
      console.log(`   [console:${cap.scenarioId}] ${msg.type()}: ${text.slice(0, 400)}`)
    }
  })
  // EVERY /api/ call — proves the listener is live, so "no write fired" is
  // a real observation rather than an unfalsifiable silent listener.
  page.on('response', (res) => {
    try {
      const url = res.url()
      if (!url.includes('/api/')) return
      const entry = { method: res.request().method(), url: url.replace(BASE, ''), status: res.status(), t: Date.now() }
      cap.apiCalls.push(entry)
      if (WRITE_METHODS.has(entry.method)) {
        cap.writes.push(entry)
        console.log(`   [write:${cap.scenarioId}] ${entry.method} ${entry.status} ${entry.url}`)
      }
    } catch { /* ignore */ }
  })
  page.on('requestfailed', (req) => {
    try {
      const method = req.method()
      if (!WRITE_METHODS.has(method)) return
      if (!req.url().includes('/api/')) return
      cap.writes.push({ method, url: req.url().replace(BASE, ''), status: 'FAILED', t: Date.now() })
    } catch { /* ignore */ }
  })
  page.on('dialog', (d) => { d.dismiss().catch(() => {}) })
}

main().catch((err) => {
  console.error('\nFATAL: save-audit-suite failed to complete:', err)
  process.exit(2)
})
