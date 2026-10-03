/**
 * Unified POI / Area migration — real browser validation (Playwright CLI).
 *
 * Disposable wizard-created map seeded with a LEGACY areas[] fixture plus a
 * synthetic campus. Verifies:
 *   A. legacy Area loads, migrates to an outdoor 2D polygon POI, is selected by
 *      clicking the fill, color change, move, save/reload;
 *   B. circle create + radius resize + 2.5D extrusion;
 *   C. rectangle create + rotate + move + save/reload;
 *   D. polygon create + move + vertex drag;
 *   E. hidden-but-searchable visibility + preferred approach anchor survives
 *      move/rotate;
 *   F. the retired Area tool is absent from the toolbar.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'

requireSafeTestEnvironment()

const BASE = 'http://localhost:3000'
const OUT = 'e2e-artifacts/unified-poi-area'
mkdirSync(OUT, { recursive: true })

const results = []
function check(name, ok, details) {
  const entry = { name, ok: Boolean(ok), details }
  results.push(entry)
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${details !== undefined ? ` :: ${JSON.stringify(details)}` : ''}`)
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

async function acquireMap(page, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ok = await page.evaluate(() => {
      const el = document.querySelector('.maplibregl-map')
      if (!el) return false
      const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber'))
      let node = el[fk]
      for (let i = 0; i < 60 && node; i++) {
        let hook = node.memoizedState
        let idx = 0
        while (hook && idx < 120) {
          try {
            const v = hook.memoizedState
            if (v && typeof v === 'object' && typeof v.getCanvas === 'function' && typeof v.queryRenderedFeatures === 'function') window.__naviMap = v
            else if (v && v.current && typeof v.current.getCanvas === 'function' && typeof v.current.queryRenderedFeatures === 'function') window.__naviMap = v.current
          } catch {}
          hook = hook.next
          idx++
        }
        node = node.return
      }
      return Boolean(window.__naviMap)
    })
    if (ok) return true
    await page.waitForTimeout(1000)
  }
  return false
}

const poiFeatures = (page) => page.evaluate(() => {
  const d = window.__naviMap?.getSource('navi-pois')?._data
  const fc = d && (d.features ? d : d.geojson)
  return fc ? fc.features : []
})

const snapshotOf = (page, mapId) => page.evaluate((id) => JSON.parse(localStorage.getItem(`navi-graph-${id}`) || 'null'), mapId)

async function selectPoiTool(page, sub) {
  await page.locator('button[title="POI"]').click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: sub, exact: true }).click()
  await page.waitForTimeout(250)
}

async function selectNavigate(page) {
  await page.getByRole('button', { name: 'Navigate', exact: true }).click()
  await page.waitForTimeout(300)
}

async function toScreen(page, lat, lng) {
  return page.evaluate(({ lat, lng }) => {
    const p = window.__naviMap.project([lng, lat])
    const r = window.__naviMap.getCanvas().getBoundingClientRect()
    return { x: r.x + p.x, y: r.y + p.y }
  }, { lat, lng })
}

async function drag(page, from, to, steps = 8) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps })
  await page.mouse.move(to.x, to.y, { steps })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(500)
}

const ORIGIN = { lat: 25.633, lng: 122.927 }

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const mockCookie = Buffer.from(JSON.stringify({
  id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null,
})).toString('base64')
await context.addCookies([{ name: 'navi-mock-session', value: mockCookie, url: BASE }])
const page = await context.newPage()
page.on('pageerror', (err) => console.log('PAGEERROR:', err.message))

let mapId = null
try {
  await page.goto(`${BASE}/studio/create`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Create New Map', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const fill = async (label, value) => {
    const box = page.getByRole('textbox', { name: label })
    await box.fill(value)
  }
  await fill('e.g., Main Campus', 'Unified POI Fixture')
  await fill('e.g., Aklan State University', 'NAVI Test')
  await fill('e.g., Ibajay Campus', 'Disposable')
  await page.waitForTimeout(200)
  if (!(await page.getByRole('button', { name: 'Next', exact: true }).isEnabled())) {
    await page.evaluate(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel)
        if (!el) return
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set('input[placeholder="e.g., Main Campus"]', 'Unified POI Fixture')
      set('input[placeholder="e.g., Aklan State University"]', 'NAVI Test')
      set('input[placeholder="e.g., Ibajay Campus"]', 'Disposable')
    })
    await page.waitForTimeout(300)
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.waitForTimeout(1500)
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(900, 450)
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(100)
  }
  const center = await page.evaluate(() => {
    const r = document.querySelector('.maplibregl-canvas').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.click(center.x - 40, center.y - 30)
  await page.mouse.click(center.x + 45, center.y - 25)
  await page.mouse.click(center.x, center.y + 50)
  await page.waitForTimeout(500)
  let hint = await page.evaluate(() => document.body.innerText.split('\n').find((line) => line.includes('points placed')) ?? null)
  if (!hint || !/3 points/.test(hint)) {
    await acquireMap(page)
    await page.evaluate(() => {
      const map = window.__naviMap
      const c = map.getCenter()
      const latLng = (lat, lng) => ({ lat, lng })
      for (const p of [latLng(c.lat - 0.0002, c.lng - 0.0002), latLng(c.lat - 0.0002, c.lng + 0.0002), latLng(c.lat + 0.0002, c.lng)]) map.fire('click', { lngLat: p })
    })
    await page.waitForTimeout(500)
    hint = await page.evaluate(() => document.body.innerText.split('\n').find((line) => line.includes('points placed')) ?? null)
  }
  console.log('BOUNDARY HINT:', hint)
  await page.screenshot({ path: `${OUT}/debug-boundary.png` })
  const listMaps = () => page.evaluate(async () => {
    try {
      const res = await fetch('/api/campus-maps', { credentials: 'include' })
      const json = await res.json()
      return json.maps ?? []
    } catch { return [] }
  })
  const idsBefore = new Set((await listMaps()).map((m) => m.id))
  await page.locator('button:has-text("Confirm & Import Buildings")').click()
  await page.waitForTimeout(800)

  let mapRecord = null
  for (let attempt = 0; attempt < 40 && !mapRecord; attempt++) {
    const maps = await listMaps()
    mapRecord = maps.find((m) => !idsBefore.has(m.id)) ?? null
    if (!mapRecord) await page.waitForTimeout(500)
  }
  if (!mapRecord?.id) {
    // Never fall back to maps[0]: local dev + e2e share the production
    // Supabase project, so an existing campus may be a protected production map.
    throw new Error(
      'No disposable map id was created; refusing to fall back to an existing campus (it may be production).',
    )
  }
  mapId = mapRecord.id
  const mapCenter = mapRecord.center ?? ORIGIN

  // Legacy fixture: building + Areas only (no pois).
  await page.evaluate(({ mapId, center }) => {
    const latLng = (lat, lng) => ({ lat, lng })
    const d = 0.00012
    const areaPoints = [
      latLng(center.lat + 0.00035, center.lng - 0.00015),
      latLng(center.lat + 0.00035, center.lng + 0.00015),
      latLng(center.lat + 0.00055, center.lng + 0.00015),
      latLng(center.lat + 0.00055, center.lng - 0.00015),
      latLng(center.lat + 0.00035, center.lng - 0.00015),
    ]
    const snapshot = {
      id: mapId, version: 1, campusId: mapId, updatedAt: new Date().toISOString(),
      buildings: [{
        id: 'poi-fixture-bld-1', name: 'POI Fixture Hall', campusId: mapId, floors: [0],
        footprint: [
          latLng(center.lat - d, center.lng - d),
          latLng(center.lat - d, center.lng + d),
          latLng(center.lat + d, center.lng + d),
          latLng(center.lat + d, center.lng - d),
          latLng(center.lat - d, center.lng - d),
        ],
        baseElevation: 0, height: 12, center: { lat: center.lat, lng: center.lng },
        code: 'FIX', description: '', color: '#1C6BEB', department: '', aliases: [], metadata: {},
        floorData: [{
          id: 'flr-poi-fixture-0', level: 0, label: 'Ground Floor', elevation: 0, metadata: {}, height: 3.5, pois: [],
          routeNetwork: { nodes: [{ id: 'rn-1', type: 'waypoint', position: { x: 1, y: 1 }, floor: 0 }], edges: [] },
          entranceAccess: [{ id: 'ea-1', entranceId: 'ent-1', outdoorNodeId: 'on-1', indoorRouteNodeId: 'rn-1' }],
        }],
      }],
      nodes: [], edges: [], components: [], traces: [],
      areas: [{ id: 'area-legacy', name: 'Legacy Plaza', points: areaPoints, color: '#8B5CF6' }],
      roads: [
        { id: 'road-1', name: 'Main', polyline: { points: [latLng(center.lat - 0.002, center.lng), latLng(center.lat - 0.002, center.lng + 0.002)] }, width: 5, surface: 'paved', type: 'arterial', metadata: {} },
        { id: 'road-2', name: 'Side', polyline: { points: [latLng(center.lat - 0.003, center.lng + 0.001), latLng(center.lat - 0.001, center.lng + 0.001)] }, width: 3, surface: 'concrete', type: 'service', metadata: {} },
      ],
      roadJunctions: [{ id: 'jct-1', position: latLng(center.lat - 0.002, center.lng + 0.001), roadIds: ['road-1', 'road-2'], source: 'authored' }],
      separatedCrossings: undefined,
    }
    localStorage.setItem(`navi-graph-${mapId}`, JSON.stringify(snapshot))
    localStorage.removeItem(`navi-sync-status-${mapId}`)
    return areaPoints
  }, { mapId, center: mapCenter })

  let mapReady = false
  for (let attempt = 0; attempt < 8 && !mapReady; attempt++) {
    await page.goto(`${BASE}/studio/${mapId}/edit`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500 + attempt * 1000)
    if (await page.evaluate(() => document.body.innerText.includes('Map not found'))) continue
    mapReady = await acquireMap(page, 4)
  }
  check('map instance acquired', mapReady)
  if (!mapReady) {
    await page.screenshot({ path: `${OUT}/debug-no-map.png` })
    console.log('NO-MAP BODY:', (await page.evaluate(() => document.body.innerText)).slice(0, 600))
    throw new Error('map instance not acquired on editor page')
  }

  // Toolbar: Area tool retired.
  const areaButton = await page.locator('button[title^="Area"]').count()
  check('Area toolbar action is retired', areaButton === 0)

  let topologyBaseline = null
  const topologyOf = (snap) => JSON.stringify({
    roads: snap?.roads, roadJunctions: snap?.roadJunctions,
    routeNetwork: snap?.buildings?.[0]?.floorData?.[0]?.routeNetwork,
    entranceAccess: snap?.buildings?.[0]?.floorData?.[0]?.entranceAccess,
  })

  // ── A. Legacy Area migration ──
  let features = await poiFeatures(page)
  let migrated = features.find((f) => f.id === 'area-legacy')
  check('legacy Area migrated to a 2D polygon POI', Boolean(migrated) && migrated.properties.geometryType === 'polygon' && migrated.properties.appearanceMode === '2d' && migrated.properties.scope === 'outdoor', migrated && { geometry: migrated.properties.geometryType, mode: migrated.properties.appearanceMode })
  check('migrated Area preserves authored color', migrated?.properties?.color === '#8B5CF6', migrated?.properties?.color)

  // Select by clicking the fill.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Navigate', exact: true }).click()
  const ring = migrated.geometry.coordinates[0]
  const inter = { lat: (ring[0][1] + ring[2][1]) / 2, lng: (ring[0][0] + ring[2][0]) / 2 }
  const interScreen = await toScreen(page, inter.lat, inter.lng)
  await page.mouse.click(interScreen.x, interScreen.y)
  await page.waitForTimeout(800)
  let bodyText = await page.evaluate(() => document.body.innerText)
  check('migrated Area selected through the fill hit path + Inspector', /Outdoor · world coordinates/.test(bodyText) && /Legacy Plaza/.test(bodyText))
  await page.screenshot({ path: `${OUT}/01-migrated-area-selected.png` })

  // Change color.
  await page.getByRole('button', { name: 'POI color #EF4444' }).click()
  await page.waitForTimeout(700)
  features = await poiFeatures(page)
  check('authored color change reaches the source', features.find((f) => f.id === 'area-legacy')?.properties?.color === '#EF4444')

  // Move the migrated polygon by dragging its body.
  const beforeMove = (await poiFeatures(page)).find((f) => f.id === 'area-legacy')
  const bodyScreen = await toScreen(page, inter.lat, inter.lng)
  const targetScreen = { x: bodyScreen.x + 60, y: bodyScreen.y - 40 }
  await drag(page, bodyScreen, targetScreen)
  const afterMove = (await poiFeatures(page)).find((f) => f.id === 'area-legacy')
  check('migrated polygon moves by body drag',
    afterMove.geometry.coordinates[0][0][0] !== beforeMove.geometry.coordinates[0][0][0]
    || afterMove.geometry.coordinates[0][0][1] !== beforeMove.geometry.coordinates[0][0][1])

  await page.waitForTimeout(7000)
  let saved = await snapshotOf(page, mapId)
  check('canonical save drops areas[] and keeps the migrated POI', (saved?.areas ?? []).length === 0 && (saved?.pois ?? []).some((p) => p.id === 'area-legacy'), { areas: saved?.areas?.length, pois: (saved?.pois ?? []).length })
  // Topology baseline is captured after the first autosave so one-time road
  // normalization is not mistaken for a POI mutation.
  topologyBaseline = topologyOf(saved)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await acquireMap(page)
  features = await poiFeatures(page)
  check('migrated Area survives reload', features.some((f) => f.id === 'area-legacy' && f.properties.color === '#EF4444'))
  await page.screenshot({ path: `${OUT}/02-after-reload.png` })

  // ── B. Circle create + resize + 2.5D ──
  await selectPoiTool(page, 'Circle')
  const canvasBox = await page.evaluate(() => {
    const r = document.querySelector('.maplibregl-canvas').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  const c1 = { x: canvasBox.x - 150, y: canvasBox.y - 120 }
  const c2 = { x: canvasBox.x - 60, y: canvasBox.y - 40 }
  await drag(page, c1, c2)
  let circle = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'circle')
  check('circle created and selected', Boolean(circle))
  // Editing handles are only live under the select tool.
  await selectNavigate(page)
  const radiusBefore = circle.geometry.coordinates[0].length
  // Radius handle sits due east of the center (worldCirclePoints ring[0] is north).
  const circleInfo = await page.evaluate(() => {
    const d = window.__naviMap.getSource('navi-pois')._data
    const fc = d.features ? d : d.geojson
    const f = fc.features.find((x) => x.properties.geometryType === 'circle')
    const ring = f.geometry.coordinates[0]
    const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
    const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length
    const metersLng = Math.max(Math.cos((lat * Math.PI) / 180) * 111320, 1)
    const radius = Math.hypot((ring[0][1] - lat) * 111320, (ring[0][0] - lng) * metersLng)
    return { lat, lng, radius }
  })
  const eastLng = circleInfo.lng + circleInfo.radius / Math.max(Math.cos((circleInfo.lat * Math.PI) / 180) * 111320, 1)
  const handleDebug = await page.evaluate(({ lat, lng }) => {
    const src = window.__naviMap.getSource('s-poi-edit')
    const raw = src && src._data
    const fc = raw && (raw.features ? raw : raw.geojson)
    const handles = (fc?.features ?? []).filter((f) => f.properties?.edit === 'handle')
    const target = window.__naviMap.project([lng, lat])
    let best = null
    for (const h of handles) {
      const p = window.__naviMap.project(h.geometry.coordinates)
      const d = Math.hypot(p.x - target.x, p.y - target.y)
      if (!best || d < best.d) best = { d: Math.round(d), coords: h.geometry.coordinates }
    }
    return { count: handles.length, target, best }
  }, { lat: circleInfo.lat, lng: eastLng })
  console.log('RADIUS HANDLE DEBUG:', JSON.stringify(handleDebug))
  const handle = await toScreen(page, circleInfo.lat, eastLng)
  const handleTarget = { x: handle.x + 70, y: handle.y }
  await drag(page, handle, handleTarget)
  const circleAfter = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'circle')
  const ringAfter = circleAfter.geometry.coordinates[0]
  const ringRadius = (ring) => {
    const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
    return Math.abs((ring[0][1] - lat) * 111320)
  }
  const radiusBeforeMeters = ringRadius(circle.geometry.coordinates[0])
  const radiusAfterMeters = ringRadius(ringAfter)
  check('circle radius handle resizes the POI',
    Math.abs(radiusAfterMeters - radiusBeforeMeters) > 0.5 && ringAfter.length === radiusBefore,
    { radiusBeforeMeters, radiusAfterMeters })
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('2.5d')
  await page.waitForTimeout(700)
  const circle25 = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'circle')
  const extrusionHit = await page.evaluate(() => {
    const d = window.__naviMap.getSource('navi-pois')._data
    const f = (d.features ? d : d.geojson).features.find((x) => x.properties.geometryType === 'circle')
    const p = window.__naviMap.project(f.geometry.coordinates[0][0])
    return window.__naviMap.queryRenderedFeatures(p, { layers: ['navi-poi-extrusion'] }).map((x) => x.properties.id)
  })
  check('circle switches to 2.5D extrusion', circle25?.properties?.appearanceMode === '2.5d' && extrusionHit.includes(circle25.id), { mode: circle25?.properties?.appearanceMode, id: circle25?.id, hit: extrusionHit })
  await page.screenshot({ path: `${OUT}/03-circle-25d.png` })

  // ── C. Rectangle create + rotate + move ──
  await selectPoiTool(page, 'Rectangle')
  const r1 = { x: canvasBox.x + 40, y: canvasBox.y + 30 }
  const r2 = { x: canvasBox.x + 150, y: canvasBox.y + 120 }
  await drag(page, r1, r2)
  const rectBefore = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'rectangle')
  check('rectangle created', Boolean(rectBefore))
  await selectNavigate(page)
  // Rotation handle: midpoint of edge 0 offset away from centroid by 28 m.
  const rotationHandle = await page.evaluate(() => {
    const d = window.__naviMap.getSource('navi-pois')._data
    const f = (d.features ? d : d.geojson).features.find((x) => x.properties.geometryType === 'rectangle')
    const pts = f.geometry.coordinates[0].slice(0, 4)
    const mid = { lat: (pts[0][1] + pts[1][1]) / 2, lng: (pts[0][0] + pts[1][0]) / 2 }
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4
    const cy = pts.reduce((s, p) => s + p[1], 0) / 4
    const dx = mid.lng - cx
    const dy = mid.lat - cy
    const len = Math.hypot(dx, dy) || 1
    const lat = mid.lat + (dy / len) * (28 / 111320)
    const lng = mid.lng + (dx / len) * (28 / (111320 * Math.cos((mid.lat * Math.PI) / 180)))
    const p = window.__naviMap.project([lng, lat])
    const r = window.__naviMap.getCanvas().getBoundingClientRect()
    return { x: r.x + p.x, y: r.y + p.y }
  })
  await drag(page, rotationHandle, { x: rotationHandle.x + 70, y: rotationHandle.y + 45 })
  const rectRotated = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'rectangle')
  check('rectangle rotation handle rotates the shape', rectRotated.geometry.coordinates[0][0][0] !== rectBefore.geometry.coordinates[0][0][0] || rectRotated.geometry.coordinates[0][0][1] !== rectBefore.geometry.coordinates[0][0][1])
  // Move by dragging the body.
  const rectCentroid = await page.evaluate(() => {
    const d = window.__naviMap.getSource('navi-pois')._data
    const f = (d.features ? d : d.geojson).features.find((x) => x.properties.geometryType === 'rectangle')
    const pts = f.geometry.coordinates[0].slice(0, 4)
    return { lat: pts.reduce((s, p) => s + p[1], 0) / 4, lng: pts.reduce((s, p) => s + p[0], 0) / 4 }
  })
  const rectScreen = await toScreen(page, rectCentroid.lat, rectCentroid.lng)
  await drag(page, rectScreen, { x: rectScreen.x + 50, y: rectScreen.y + 30 })
  const rectMoved = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'rectangle')
  check('rectangle body drag moves the shape', rectMoved.geometry.coordinates[0][0][0] !== rectRotated.geometry.coordinates[0][0][0])
  await page.waitForTimeout(7000)
  saved = await snapshotOf(page, mapId)
  const rectPersisted = (saved?.pois ?? []).find((p) => p.id === rectMoved.id)
  const persistedCorner = rectPersisted?.geometry?.points?.[0]
  const movedCorner = rectMoved.geometry.coordinates[0][0]
  check('rotated/moved rectangle persists through save',
    Boolean(rectPersisted) && Boolean(persistedCorner) && close(persistedCorner.lng, movedCorner[0], 1e-9) && close(persistedCorner.lat, movedCorner[1], 1e-9),
    { persistedCorner, movedCorner })
  await page.screenshot({ path: `${OUT}/04-rectangle-rotated.png` })

  // ── D. Polygon create + move + vertex drag ──
  await selectPoiTool(page, 'Polygon')
  const v1 = await toScreen(page, mapCenter.lat - 0.0004, mapCenter.lng - 0.0004)
  const v2 = { x: v1.x + 110, y: v1.y }
  const v3 = { x: v1.x + 60, y: v1.y + 90 }
  await page.mouse.click(v1.x, v1.y)
  await page.waitForTimeout(250)
  await page.mouse.click(v2.x, v2.y)
  await page.mouse.click(v3.x, v3.y)
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  const polyBefore = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'polygon' && f.id !== 'area-legacy')
  check('polygon created', Boolean(polyBefore))
  await selectNavigate(page)
  // Move via body.
  const polyCentroid = await page.evaluate(() => {
    const d = window.__naviMap.getSource('navi-pois')._data
    const f = (d.features ? d : d.geojson).features.find((x) => x.properties.geometryType === 'polygon' && x.id !== 'area-legacy')
    const pts = f.geometry.coordinates[0].slice(0, -1)
    return { lat: pts.reduce((s, p) => s + p[1], 0) / pts.length, lng: pts.reduce((s, p) => s + p[0], 0) / pts.length }
  })
  const polyScreen = await toScreen(page, polyCentroid.lat, polyCentroid.lng)
  await drag(page, polyScreen, { x: polyScreen.x - 40, y: polyScreen.y + 40 })
  const polyMoved = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'polygon' && f.id !== 'area-legacy')
  check('polygon body drag moves the shape', JSON.stringify(polyMoved.geometry.coordinates[0][0]) !== JSON.stringify(polyBefore.geometry.coordinates[0][0]))
  // Vertex drag: first vertex handle.
  const vertexScreen = await toScreen(page, polyMoved.geometry.coordinates[0][0][1], polyMoved.geometry.coordinates[0][0][0])
  await drag(page, vertexScreen, { x: vertexScreen.x - 35, y: vertexScreen.y - 30 })
  const polyVertex = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'polygon' && f.id !== 'area-legacy')
  check('polygon vertex drag reshapes the POI', JSON.stringify(polyVertex.geometry.coordinates[0][0]) !== JSON.stringify(polyMoved.geometry.coordinates[0][0]))
  await page.screenshot({ path: `${OUT}/05-polygon-edited.png` })

  // ── E. Visibility + preferred anchor ──
  // Hide the circle but keep it searchable.
  await page.getByRole('button', { name: 'Navigate', exact: true }).click()
  const circleFeature = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'circle')
  const circleRing = circleFeature.geometry.coordinates[0]
  const circleCenterLat = circleRing.reduce((s, c) => s + c[1], 0) / circleRing.length
  const circleCenterLng = circleRing.reduce((s, c) => s + c[0], 0) / circleRing.length
  const circleCenter = await toScreen(page, circleCenterLat, circleCenterLng)
  await page.mouse.click(circleCenter.x, circleCenter.y)
  await page.waitForTimeout(600)
  const showOnMap = page.getByRole('checkbox', { name: 'Show on map' })
  if (await showOnMap.isChecked()) await showOnMap.click()
  await page.waitForTimeout(700)
  const searchable = page.getByRole('checkbox', { name: 'Searchable' })
  if (!(await searchable.isChecked())) await searchable.click()
  await page.waitForTimeout(7000)
  saved = await snapshotOf(page, mapId)
  const hiddenPoi = (saved?.pois ?? []).find((p) => p.id === circleFeature.id)
  check('hidden-but-searchable visibility persists', JSON.stringify(hiddenPoi?.visibility) === JSON.stringify({ showOnMap: false, searchable: true }),
    { id: circleFeature.id, visibility: hiddenPoi?.visibility, all: (saved?.pois ?? []).map((p) => ({ id: p.id, v: p.visibility })) })

  // Preferred anchor on the rectangle (click the interior, not a corner handle).
  const rectFeature = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'rectangle')
  const rectPts = rectFeature.geometry.coordinates[0].slice(0, 4)
  const rectCenterPoint = {
    lat: rectPts.reduce((s, p) => s + p[1], 0) / 4,
    lng: rectPts.reduce((s, p) => s + p[0], 0) / 4,
  }
  const rectHit = await toScreen(page, rectCenterPoint.lat, rectCenterPoint.lng)
  await page.mouse.click(rectHit.x, rectHit.y)
  await page.waitForTimeout(600)
  await page.getByRole('combobox', { name: 'Approach' }).selectOption('preferred')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Pick approach anchor' }).click()
  // Click near the top edge midpoint of the rectangle.
  const edgeMid = {
    lat: (rectFeature.geometry.coordinates[0][0][1] + rectFeature.geometry.coordinates[0][1][1]) / 2,
    lng: (rectFeature.geometry.coordinates[0][0][0] + rectFeature.geometry.coordinates[0][1][0]) / 2,
  }
  const edgeScreen = await toScreen(page, edgeMid.lat, edgeMid.lng)
  await page.mouse.click(edgeScreen.x, edgeScreen.y)
  await page.waitForTimeout(7000)
  saved = await snapshotOf(page, mapId)
  const anchored = (saved?.pois ?? []).find((p) => p.id === rectFeature.id)
  check('preferred anchor stored relative to the geometry', anchored?.navigation?.approachMode === 'preferred' && anchored?.navigation?.anchor?.kind === 'rectangle-edge',
    { id: rectFeature.id, navigation: anchored?.navigation, all: (saved?.pois ?? []).map((p) => ({ id: p.id, nav: p.navigation })) })

  // Move the shape; the stored relative anchor must remain attached.
  await page.mouse.click(rectHit.x, rectHit.y)
  await page.waitForTimeout(500)
  const rectNow = (await poiFeatures(page)).find((f) => f.properties.geometryType === 'rectangle')
  const rectNowCentroid = await page.evaluate(() => {
    const d = window.__naviMap.getSource('navi-pois')._data
    const f = (d.features ? d : d.geojson).features.find((x) => x.properties.geometryType === 'rectangle')
    const pts = f.geometry.coordinates[0].slice(0, 4)
    return { lat: pts.reduce((s, p) => s + p[1], 0) / 4, lng: pts.reduce((s, p) => s + p[0], 0) / 4 }
  })
  const rectBodyScreen = await toScreen(page, rectNowCentroid.lat, rectNowCentroid.lng)
  await drag(page, rectBodyScreen, { x: rectBodyScreen.x + 45, y: rectBodyScreen.y - 25 })
  await page.waitForTimeout(7000)
  saved = await snapshotOf(page, mapId)
  const anchoredAfterMove = (saved?.pois ?? []).find((p) => p.id === rectNow.id)
  check('anchor stays attached (relative value unchanged) after moving the shape', JSON.stringify(anchoredAfterMove?.navigation) === JSON.stringify(anchored?.navigation), anchoredAfterMove?.navigation)
  await page.screenshot({ path: `${OUT}/06-anchor.png` })

  // ── Topology invariant ──
  await page.waitForTimeout(7000)
  const finalSnap = await snapshotOf(page, mapId)
  check('NO POI TOPOLOGY MUTATION', topologyOf(finalSnap) === topologyBaseline)
} catch (error) {
  check('browser run completed without uncaught error', false, String(error?.stack ?? error))
} finally {
  if (mapId) {
    try {
      await page.evaluate((id) => {
        const parsed = JSON.parse(localStorage.getItem('navi-campus-maps') || '{}')
        if (parsed.state?.maps) parsed.state.maps = parsed.state.maps.filter((m) => m.id !== id)
        if (Array.isArray(parsed.maps)) parsed.maps = parsed.maps.filter((m) => m.id !== id)
        localStorage.setItem('navi-campus-maps', JSON.stringify(parsed))
        localStorage.removeItem(`navi-graph-${id}`)
        localStorage.removeItem(`navi-sync-status-${id}`)
      }, mapId)
      await page.evaluate(async (id) => {
        try { await fetch(`/api/campus-maps?map_id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' }) } catch {}
      }, mapId)
    } catch {}
  }
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\nBROWSER VALIDATION — ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}
