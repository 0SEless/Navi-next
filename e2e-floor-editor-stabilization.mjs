import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

/**
 * Floor Editor stabilization — disposable browser verification.
 *
 * The campus-map shell exists only long enough for the server-rendered editor
 * route to resolve. Graph GET/POST requests are intercepted, so authored test
 * geometry stays in this browser context and localStorage. The map shell and
 * local keys are removed in finally.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const OUT = 'e2e-artifacts/floor-editor-stabilization'
mkdirSync(OUT, { recursive: true })

const results = []
function check(name, ok, details) {
  const entry = { name, ok: Boolean(ok), details }
  results.push(entry)
  console.log(`${entry.ok ? 'PASS' : 'FAIL'} — ${name}${details === undefined ? '' : ` :: ${JSON.stringify(details)}`}`)
}

const sleep = (page, ms = 500) => page.waitForTimeout(ms)
const floorSnapshot = (page, mapId) => page.evaluate((id) => {
  const graph = JSON.parse(localStorage.getItem(`navi-graph-${id}`) || 'null')
  return { graph, floor: graph?.buildings?.[0]?.floorData?.[0] ?? null }
}, mapId)

// The canonical snapshot is written by a debounced autosave; poll instead of
// trusting a short fixed sleep (ERRORS.md 2026-09-13 autosave-timing entry).
async function waitForSnapshot(page, mapId, predicate, timeout = 15000) {
  const started = Date.now()
  let snapshot = await floorSnapshot(page, mapId)
  while (!predicate(snapshot) && Date.now() - started < timeout) {
    await sleep(page, 300)
    snapshot = await floorSnapshot(page, mapId)
  }
  return snapshot
}

async function acquireMap(page, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const acquired = await page.evaluate(() => {
      const element = document.querySelector('.maplibregl-map')
      if (!element) return false
      const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'))
      let node = fiberKey ? element[fiberKey] : null
      for (let depth = 0; depth < 70 && node; depth += 1) {
        let hook = node.memoizedState
        for (let index = 0; hook && index < 140; index += 1) {
          try {
            const value = hook.memoizedState
            const candidate = value?.current ?? value
            if (candidate && typeof candidate.project === 'function' && typeof candidate.queryRenderedFeatures === 'function') {
              window.__floorStabilizationMap = candidate
            }
          } catch {}
          hook = hook.next
        }
        node = node.return
      }
      return Boolean(window.__floorStabilizationMap)
    })
    if (acquired) return true
    await sleep(page, 500)
  }
  return false
}

const sourceFeatures = (page, sourceId) => page.evaluate((id) => {
  const data = window.__floorStabilizationMap?.getSource(id)?._data
  const collection = data && (data.features ? data : data.geojson)
  return collection?.features ?? []
}, sourceId)

async function waitForSourceFeatures(page, sourceId, predicate, timeout = 10000) {
  const started = Date.now()
  let features = await sourceFeatures(page, sourceId)
  while (!predicate(features) && Date.now() - started < timeout) {
    await sleep(page, 300)
    features = await sourceFeatures(page, sourceId)
  }
  return features
}

async function featureCenter(page, sourceId, featureId) {
  return page.evaluate(({ sourceId: id, featureId: wanted }) => {
    const data = window.__floorStabilizationMap.getSource(id)?._data
    const features = (data?.features ? data : data?.geojson)?.features ?? []
    const feature = features.find((candidate) => String(candidate.properties?.id ?? candidate.id) === wanted)
    if (!feature) return null
    const geometry = feature.geometry
    const ring = geometry.type === 'Polygon'
      ? geometry.coordinates[0].slice(0, -1)
      : geometry.type === 'LineString'
        ? geometry.coordinates
        : [geometry.coordinates]
    const lng = ring.reduce((sum, point) => sum + point[0], 0) / ring.length
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length
    const projected = window.__floorStabilizationMap.project([lng, lat])
    const bounds = window.__floorStabilizationMap.getCanvas().getBoundingClientRect()
    return { x: bounds.x + projected.x, y: bounds.y + projected.y }
  }, { sourceId, featureId })
}

async function handleScreen(page, type, vertexIndex) {
  return page.evaluate(({ type: wantedType, vertexIndex: wantedIndex }) => {
    const data = window.__floorStabilizationMap.getSource('floor-vertex-handles')?._data
    const features = (data?.features ? data : data?.geojson)?.features ?? []
    const feature = features.find((candidate) => candidate.properties?.type === wantedType
      && (wantedIndex === undefined || candidate.properties?.vertexIndex === wantedIndex))
    if (!feature) return null
    const projected = window.__floorStabilizationMap.project(feature.geometry.coordinates)
    const bounds = window.__floorStabilizationMap.getCanvas().getBoundingClientRect()
    return { x: bounds.x + projected.x, y: bounds.y + projected.y }
  }, { type, vertexIndex })
}

async function drag(page, from, to) {
  if (!from || !to) throw new Error(`Cannot drag missing coordinates: ${JSON.stringify({ from, to })}`)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  await sleep(page, 650)
}

async function clickTool(page, title) {
  await page.locator(`button[title="${title}"]`).click()
  await sleep(page, 250)
}

const center = { lat: 11.8195, lng: 122.09225 }
const mapId = `map-floor-stabilization-${Date.now()}`
const buildingId = 'bld-floor-stabilization'
const floorId = 'flr-floor-stabilization-0'
const now = new Date().toISOString()
const d = 0.00016
const mapRecord = {
  id: mapId,
  name: 'Floor Stabilization Fixture',
  schoolName: 'NAVI Test',
  campusName: 'Disposable',
  boundary: [
    { lat: center.lat - d * 3, lng: center.lng - d * 3 },
    { lat: center.lat - d * 3, lng: center.lng + d * 3 },
    { lat: center.lat + d * 3, lng: center.lng + d * 3 },
    { lat: center.lat + d * 3, lng: center.lng - d * 3 },
  ],
  center,
  createdAt: now,
  updatedAt: now,
  stats: { buildings: 1, nodes: 0, edges: 0 },
}

const metersToWorld = (x, y) => ({
  lat: center.lat + y / 111320,
  lng: center.lng + x / (111320 * Math.cos(center.lat * Math.PI / 180)),
})
const roomComponent = (id, name, minX, maxX) => ({
  id,
  type: 'room',
  name,
  buildingId,
  campusId: mapId,
  floor: 0,
  position: metersToWorld((minX + maxX) / 2, 0),
  polygon: [metersToWorld(minX, -7), metersToWorld(maxX, -7), metersToWorld(maxX, 7), metersToWorld(minX, 7)],
  metadata: {},
})

// Two wall enclosures on the fixture floor. With no RoomAttributes present the
// ownership resolver keeps using the legacy Room polygons, so every earlier
// check is unaffected; the semantic check declares one face with the Room tool
// and one attribute-only face through the production declare command.
const wallEntity = (id, x1, y1, x2, y2) => ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.15, height: 3.5, metadata: {} })
const wallEnclosure = (prefix, minX, minY, maxX, maxY) => [
  wallEntity(`${prefix}-south`, minX, minY, maxX, minY),
  wallEntity(`${prefix}-east`, maxX, minY, maxX, maxY),
  wallEntity(`${prefix}-north`, maxX, maxY, minX, maxY),
  wallEntity(`${prefix}-west`, minX, maxY, minX, minY),
]
const semanticEnclosureA = wallEnclosure('semantic-a', 10, 2, 14, 6)
const semanticEnclosureB = wallEnclosure('semantic-b', 10, -6, 14, -2)

const graph = {
  id: mapId,
  version: 1,
  campusId: mapId,
  updatedAt: now,
  buildings: [{
    id: buildingId,
    name: 'Fixture Hall',
    campusId: mapId,
    floors: [0],
    footprint: [
      { lat: center.lat - d, lng: center.lng - d },
      { lat: center.lat - d, lng: center.lng + d },
      { lat: center.lat + d, lng: center.lng + d },
      { lat: center.lat + d, lng: center.lng - d },
      { lat: center.lat - d, lng: center.lng - d },
    ],
    baseElevation: 0,
    height: 8,
    center,
    code: 'TEST',
    description: '',
    color: '#1C6BEB',
    department: '',
    aliases: [],
    metadata: {},
    floorData: [{
      id: floorId,
      level: 0,
      label: 'Ground Floor',
      elevation: 0,
      height: 3.5,
      metadata: {},
      rooms: [
        { id: 'room-left', name: 'Computer Laboratory', number: 'L-101', polygon: { points: [{ x: -9, y: -7 }, { x: 0, y: -7 }, { x: 0, y: 7 }, { x: -9, y: 7 }] }, color: '#DBEAFE' },
        { id: 'room-right', name: 'Room 102', number: '102', polygon: { points: [{ x: 0, y: -7 }, { x: 9, y: -7 }, { x: 9, y: 7 }, { x: 0, y: 7 }] }, color: '#DCFCE7' },
      ],
      hallways: [],
      walls: [...semanticEnclosureA, ...semanticEnclosureB],
      staircases: [],
      elevators: [],
      doors: [{
        id: 'orphan-door',
        doorType: 'standard',
        position: { x: -5, y: 0 },
        width: 0.9,
        depth: 0.2,
        rotation: 0,
        geometry: { type: 'rectangle', min: { x: -5.45, y: -0.1 }, max: { x: -4.55, y: 0.1 }, rotation: 0 },
        metadata: {},
      }],
      entrances: [{ id: 'entrance-fixture', label: 'Main Entrance', position: { x: -8, y: 0 }, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
      connectorStops: [],
      parametricComponents: [],
      routeNetwork: {
        nodes: [
          { id: 'route-fixture-1', type: 'waypoint', position: { x: 6, y: 0 }, floor: 0 },
          { id: 'route-fixture-2', type: 'waypoint', position: { x: -6, y: 0 }, floor: 0 },
        ],
        edges: [{ id: 'route-fixture-edge-1', from: 'route-fixture-1', to: 'route-fixture-2', type: 'walk', distance: 12 }],
      },
    }],
  }],
  nodes: [],
  edges: [],
  components: [
    roomComponent('room-left', 'Computer Laboratory', -9, 0),
    roomComponent('room-right', 'Room 102', 0, 9),
    {
      id: 'entrance-fixture', type: 'entrance', name: 'Main Entrance', buildingId, campusId: mapId, floor: 0,
      position: metersToWorld(-8, 0), metadata: { hasQR: false, hasPanorama: false },
    },
  ],
  traces: [],
  areas: [],
  pois: [],
  roads: [],
  roadJunctions: [],
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const mockCookie = Buffer.from(JSON.stringify({
  id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null,
})).toString('base64')
await context.addCookies([{ name: 'navi-mock-session', value: mockCookie, url: BASE }])
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
let graphPostMode = 'success'

let shellCreated = false
try {
  await page.goto(`${BASE}/studio/create`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const createResult = await page.evaluate(async (record) => {
    const response = await fetch('/api/campus-maps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(record),
    })
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) }
  }, mapRecord)
  shellCreated = createResult.ok && createResult.body?.success !== false
  check('disposable campus-map shell created', shellCreated, createResult)
  if (!shellCreated) throw new Error('Could not create disposable campus-map shell')

  await page.route('**/api/graph*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '1.0.0', campusId: mapId, buildings: [], nodes: [], edges: [], components: [] }) })
      return
    }
    if (graphPostMode === 'conflict') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The server changed since this editor loaded it. Your local changes were not overwritten.' }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, updatedAt: new Date().toISOString() }) })
  })

  await page.evaluate(({ mapRecord: record, graph: snapshot }) => {
    localStorage.setItem('navi-campus-maps', JSON.stringify({ maps: [record], landmarkTypes: [], landmarkInstances: [] }))
    localStorage.setItem(`navi-graph-${record.id}`, JSON.stringify(snapshot))
    localStorage.removeItem(`navi-sync-status-${record.id}`)
  }, { mapRecord, graph })

  await page.goto(`${BASE}/studio/${mapId}/edit/building/${buildingId}/floor/0`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.maplibregl-map', { timeout: 30000 })
  const mapReady = await acquireMap(page)
  check('disposable Floor Editor map acquired', mapReady)
  if (!mapReady) throw new Error('MapLibre instance not acquired')
  const continueWithoutPlan = page.getByRole('button', { name: 'Continue without floor plan', exact: true })
  if (await continueWithoutPlan.isVisible().catch(() => false)) {
    await continueWithoutPlan.click()
    await sleep(page, 500)
  }
  await sleep(page, 1800)

  const adoptedSnapshot = await waitForSnapshot(page, mapId, (candidate) => candidate.floor?.doors?.some((door) => door.id === 'orphan-door' && door.roomId === 'room-left'))
  const adoptedOrphan = adoptedSnapshot.floor?.doors?.find((door) => door.id === 'orphan-door')
  check('seeded orphan Door is silently adopted by its containing Room on floor open', adoptedOrphan?.roomId === 'room-left' && adoptedOrphan?.ownership?.status === 'assigned', adoptedOrphan)

  const rooms = await sourceFeatures(page, 'floor-rooms')
  check('populated 2D floor renders both fixture Rooms', rooms.length === 2, rooms.map((feature) => feature.properties?.id))
  const leftCenter = await featureCenter(page, 'floor-rooms', 'room-left')
  const rightCenter = await featureCenter(page, 'floor-rooms', 'room-right')

  await clickTool(page, 'Door')
  const rectangleStatus = page.getByTestId('floor-rectangle-authoring-status')
  check('Door activation explains the rectangle gesture', await rectangleStatus.innerText() === 'Door: click and drag to draw a rectangle.', await rectangleStatus.innerText())
  await page.mouse.click(leftCenter.x, leftCenter.y)
  await sleep(page, 100)
  check('Door click explains why no object was created', await rectangleStatus.innerText() === 'No Door created — drag at least 0.2 m wide and deep.', await rectangleStatus.innerText())
  await drag(page, { x: leftCenter.x - 28, y: leftCenter.y - 18 }, { x: leftCenter.x + 28, y: leftCenter.y + 18 })
  let doors = await sourceFeatures(page, 'floor-door-areas')
  const createdDoors = doors.filter((feature) => String(feature.properties?.id ?? '') !== 'orphan-door')
  check('Door click-drag creates one new spatial footprint beside the seeded orphan', createdDoors.length === 1 && doors.length === 2, doors.map((feature) => feature.properties?.id))
  const doorId = String(createdDoors[0]?.properties?.id ?? '')
  check('Door creation keeps Inspector editing available', await page.getByRole('combobox', { name: 'Door parent room' }).isVisible())

  const nameInput = page.locator('main input:not([type])').last()
  await nameInput.fill('Browser Main Door')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await sleep(page, 350)
  // Route layers default to hidden in Architecture; starting the pick must
  // reveal them itself (no manual Graph toggle), otherwise MapLibre's
  // queryRenderedFeatures cannot resolve the node/edge click.
  await page.getByRole('button', { name: 'Navigation Preview', exact: true }).click()
  await page.getByRole('button', { name: 'Connect to Route…', exact: true }).click()
  const routeLayersAutoRevealed = await page.waitForFunction(() => {
    const map = window.__floorStabilizationMap
    return Boolean(map?.getLayer('floor-route-nodes-circle') && map.getLayer('floor-route-edges-line'))
      && map.getLayoutProperty('floor-route-nodes-circle', 'visibility') === 'visible'
      && map.getLayoutProperty('floor-route-edges-line', 'visibility') === 'visible'
  }, null, { timeout: 5000 }).then(() => true, () => false)
  check('door pick auto-reveals the hidden route layers', routeLayersAutoRevealed)
  const routeNodeCenter = await featureCenter(page, 'floor-route-nodes', 'route-fixture-1')
  await page.mouse.click(routeNodeCenter.x, routeNodeCenter.y)
  await sleep(page, 7000)
  let snapshot = await floorSnapshot(page, mapId)
  let door = snapshot.floor?.doors?.find((candidate) => candidate.id === doorId)
  check('Door inside Room receives its parent roomId', door?.roomId === 'room-left', door?.roomId)
  check('Door route connection is explicit and persisted locally', door?.routeConnection?.targetRouteNodeId === 'route-fixture-1', door?.routeConnection)
  check('Door metadata is editable in Inspector', door?.name === 'Browser Main Door', door?.name)

  const outlinerText = await page.locator('main').innerText()
  check('Outliner nests the assigned Door under its Room with a Doors subfolder', outlinerText.includes('Computer Laboratory') && outlinerText.includes('Doors ('), outlinerText.includes('Computer Laboratory'))
  check('Unassigned Doors group is absent while every Door is assigned', !outlinerText.includes('Unassigned Doors'), outlinerText.includes('Unassigned Doors'))

  const beforeManualReconcile = await floorSnapshot(page, mapId)
  await page.getByRole('button', { name: 'Reconcile room ownership' }).click()
  await sleep(page, 800)
  const afterManualReconcile = await floorSnapshot(page, mapId)
  check('manual Reconcile room ownership is an idempotent no-op', JSON.stringify(beforeManualReconcile.floor) === JSON.stringify(afterManualReconcile.floor), { doors: afterManualReconcile.floor?.doors?.length, roomAttributes: afterManualReconcile.floor?.roomAttributes?.length ?? 0 })

  await clickTool(page, 'Door')
  await drag(page, { x: rightCenter.x + 40, y: rightCenter.y + 60 }, { x: rightCenter.x + 80, y: rightCenter.y + 100 })
  const doorsAfter = await sourceFeatures(page, 'floor-door-areas')
  const door2Id = String(doorsAfter.find(feature => feature.properties?.id !== doorId && feature.properties?.id !== 'orphan-door')?.properties?.id ?? '')
  check('second Door created for segment connection', Boolean(door2Id), door2Id)

  await page.locator('main input:not([type])').last().fill('Segment Door')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await sleep(page, 350)
  await page.getByRole('button', { name: 'Connect to Route…', exact: true }).click()
  const edgeCenter = await featureCenter(page, 'floor-route-edges', 'route-fixture-edge-1')
  await page.mouse.click(edgeCenter.x, edgeCenter.y)
  await page.waitForSelector('[data-testid="door-route-connect-prompt"]', { timeout: 5000 })
  // The route authoring toast must stay visible and its pointer-events must let
  // this Yes click through, with no Dismiss workaround.
  const toastStillVisible = await page.getByRole('button', { name: 'Dismiss route message' }).isVisible()
  check('junction prompt is confirmed with the route toast still visible', toastStillVisible)
  const beforeJunction = await floorSnapshot(page, mapId)
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  await sleep(page, 7000)
  const afterJunction = await floorSnapshot(page, mapId)
  const door2 = afterJunction.floor?.doors?.find(candidate => candidate.id === door2Id)
  const junctionId = door2?.routeConnection?.targetRouteNodeId
  const junction = afterJunction.floor?.routeNetwork?.nodes.find(node => node.id === junctionId)
  const incident = afterJunction.floor?.routeNetwork?.edges?.filter(edge => edge.from === junctionId || edge.to === junctionId) ?? []
  check('door segment connect creates a shared junction (split + connector)', junction?.type === 'waypoint' && incident.length === 3, { junction, incident: incident.length })
  check('segment junction split added topology', (afterJunction.floor?.routeNetwork?.edges?.length ?? 0) === (beforeJunction.floor?.routeNetwork?.edges?.length ?? 0) + 2, { before: beforeJunction.floor?.routeNetwork?.edges?.length ?? 0, after: afterJunction.floor?.routeNetwork?.edges?.length ?? 0 })

  // The route connector now runs under the Door footprint; route layers sit
  // above it and would steal canvas selection, so hide the graph again for the
  // Door interaction checks.
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  await sleep(page, 500)

  await clickTool(page, 'Navigate')
  let doorCenter = await featureCenter(page, 'floor-door-areas', doorId)
  await page.mouse.click(doorCenter.x, doorCenter.y)
  await sleep(page, 350)
  const widthBefore = door?.width
  const resizeHandle = await handleScreen(page, 'vertex', 2)
  await drag(page, resizeHandle, { x: resizeHandle.x + 22, y: resizeHandle.y + 18 })
  doorCenter = await featureCenter(page, 'floor-door-areas', doorId)
  await page.mouse.click(doorCenter.x, doorCenter.y)
  await sleep(page, 350)
  const rotateHandle = await handleScreen(page, 'rotate')
  const doorCenterForRotation = await featureCenter(page, 'floor-door-areas', doorId)
  const handleDistance = Math.hypot(rotateHandle.x - doorCenterForRotation.x, rotateHandle.y - doorCenterForRotation.y)
  check('rotation handle stays close in screen space', handleDistance > 24 && handleDistance < 120, handleDistance)
  await drag(page, rotateHandle, { x: rotateHandle.x + 55, y: rotateHandle.y + 35 })
  doorCenter = await featureCenter(page, 'floor-door-areas', doorId)
  await page.mouse.click(doorCenter.x, doorCenter.y)
  await sleep(page, 350)
  await drag(page, doorCenter, rightCenter)
  await sleep(page, 7000)
  snapshot = await floorSnapshot(page, mapId)
  door = snapshot.floor?.doors?.find((candidate) => candidate.id === doorId)
  check('Door corner drag resizes the canonical rectangle', Number(door?.width) !== Number(widthBefore), { before: widthBefore, after: door?.width })
  check('Door rotation persists on the canonical object', Math.abs(Number(door?.rotation ?? 0)) > 0.01, door?.rotation)
  check('moving Door into another Room reparents it', door?.roomId === 'room-right', door?.roomId)
  check('Door remains nested under its Room in the Outliner', (await page.locator('main').innerText()).includes('Browser Main Door'))

  const doorGeometry = async (id) => JSON.stringify((await sourceFeatures(page, 'floor-door-areas')).find((feature) => feature.properties?.id === id)?.geometry)
  const movedGeometry = await doorGeometry(doorId)
  await page.keyboard.press('Control+z')
  await sleep(page, 650)
  const undoGeometry = await doorGeometry(doorId)
  await page.keyboard.press('Control+Shift+z')
  await sleep(page, 650)
  const redoGeometry = await doorGeometry(doorId)
  check('Door move participates in undo/redo', undoGeometry !== movedGeometry && redoGeometry === movedGeometry)

  // ── Panel Duplicate (Task 9 addition 5) ──
  const beforeDuplicate = await floorSnapshot(page, mapId)
  const sourceDoorBeforeDuplicate = beforeDuplicate.floor?.doors?.find((candidate) => candidate.id === doorId)
  const doorCountBeforeDuplicate = beforeDuplicate.floor?.doors?.length ?? 0
  const sourceDoorCenter = await featureCenter(page, 'floor-door-areas', doorId)
  await page.mouse.click(sourceDoorCenter.x, sourceDoorCenter.y)
  await sleep(page, 350)
  check('source Door Inspector shows its route connection before duplication', (await page.locator('main').innerText()).includes('Connected to route-fixture-1'))
  const duplicateButton = page.getByRole('button', { name: 'Duplicate', exact: true })
  check('Door Inspector exposes the Duplicate action', await duplicateButton.isVisible())
  await duplicateButton.click()
  const afterDuplicate = await waitForSnapshot(page, mapId, (snapshot) => (snapshot.floor?.doors?.length ?? 0) === doorCountBeforeDuplicate + 1)
  const duplicateId = (afterDuplicate.floor?.doors ?? []).map((candidate) => candidate.id).find((id) => !(beforeDuplicate.floor?.doors ?? []).some((candidate) => candidate.id === id))
  const duplicateDoor = afterDuplicate.floor?.doors?.find((candidate) => candidate.id === duplicateId)
  const duplicateOffsetX = Number(duplicateDoor?.position?.x) - Number(sourceDoorBeforeDuplicate?.position?.x)
  const duplicateOffsetY = Number(duplicateDoor?.position?.y) - Number(sourceDoorBeforeDuplicate?.position?.y)
  check('panel Duplicate adds exactly one new Door', Boolean(duplicateId) && (afterDuplicate.floor?.doors?.length ?? 0) === doorCountBeforeDuplicate + 1, duplicateId)
  check('panel duplicate receives a new identity and a ~0.5 m offset', duplicateId !== doorId && Math.abs(duplicateOffsetX - 0.5) < 0.05 && Math.abs(duplicateOffsetY - 0.5) < 0.05, { duplicateId, duplicateOffsetX, duplicateOffsetY })
  check('panel duplicate keeps canonical room ownership', duplicateDoor?.roomId === sourceDoorBeforeDuplicate?.roomId && duplicateDoor?.ownership?.status === 'assigned', { roomId: duplicateDoor?.roomId, sourceRoomId: sourceDoorBeforeDuplicate?.roomId })
  check('panel duplicate never copies the source route connection', duplicateDoor?.routeConnection === undefined, duplicateDoor?.routeConnection)
  check('selection follows the panel duplicate', !(await page.locator('main').innerText()).includes('Connected to route-fixture-1'))

  // ── Ctrl+D duplicate (Task 9 addition 6) ──
  const idsAfterDuplicate = new Set((afterDuplicate.floor?.doors ?? []).map((candidate) => candidate.id))
  const doorCountBeforeCtrlD = afterDuplicate.floor?.doors?.length ?? 0
  const duplicateCenter = await featureCenter(page, 'floor-door-areas', duplicateId)
  await page.mouse.click(duplicateCenter.x, duplicateCenter.y)
  await sleep(page, 350)
  await page.keyboard.press('Control+d')
  const afterCtrlD = await waitForSnapshot(page, mapId, (snapshot) => (snapshot.floor?.doors?.length ?? 0) === doorCountBeforeCtrlD + 1)
  const ctrlDDoor = (afterCtrlD.floor?.doors ?? []).find((candidate) => !idsAfterDuplicate.has(candidate.id))
  check('Ctrl+D duplicates the selected Door with a new identity', Boolean(ctrlDDoor?.id) && ctrlDDoor?.id !== duplicateId, ctrlDDoor?.id)
  check('Ctrl+D duplicate never copies a route connection', ctrlDDoor?.routeConnection === undefined, ctrlDDoor?.routeConnection)
  await page.keyboard.press('Control+z')
  const afterCtrlDUndo = await waitForSnapshot(page, mapId, (snapshot) => !(snapshot.floor?.doors ?? []).some((candidate) => candidate.id === ctrlDDoor?.id))
  check('Ctrl+Z removes the Ctrl+D duplicate from canonical state', (afterCtrlDUndo.floor?.doors?.length ?? 0) === doorCountBeforeCtrlD, afterCtrlDUndo.floor?.doors?.length)

  await page.getByRole('button', { name: 'Navigation', exact: true }).click()
  await clickTool(page, 'Stair')
  await drag(page, { x: leftCenter.x - 28, y: leftCenter.y - 90 }, { x: leftCenter.x + 25, y: leftCenter.y - 45 })
  const stairs = await sourceFeatures(page, 'floor-stair-areas')
  check('Stair click-drag creates an editable footprint', stairs.length === 1, stairs.map((feature) => feature.properties?.id))
  check('Stair Inspector exposes rectangle editing', await page.getByRole('spinbutton', { name: 'Stair rotation' }).isVisible())

  await clickTool(page, 'Elevator')
  await drag(page, { x: rightCenter.x - 25, y: rightCenter.y + 45 }, { x: rightCenter.x + 28, y: rightCenter.y + 90 })
  const elevators = await sourceFeatures(page, 'floor-elevator-areas')
  check('Elevator click-drag creates an editable footprint', elevators.length === 1, elevators.map((feature) => feature.properties?.id))
  check('Elevator Inspector exposes rectangle editing', await page.getByRole('spinbutton', { name: 'Elevator rotation' }).isVisible())

  const entrances = (await sourceFeatures(page, 'floor-point-items')).filter((feature) => feature.properties?.type === 'entrance')
  check('Entrance remains visibly represented on the Floor canvas', entrances.some((feature) => feature.properties?.id === 'entrance-fixture'))

  await clickTool(page, 'Route')
  await page.mouse.click(rightCenter.x + 60, rightCenter.y + 70) // free first vertex
  const routeSnapshotBefore = await floorSnapshot(page, mapId)
  const routeEdgesBefore = routeSnapshotBefore.floor?.routeNetwork?.edges?.length ?? 0
  // Door connector stubs are Door-owned and rejected as junction targets, so
  // filter them out of the pick. The remaining split half's midpoint is clear
  // of every route node at the fixture's map scale (the first edge is
  // collinear with the door junction, whose node circle covers its midpoint).
  const connectorEdgeIds = new Set(
    (routeSnapshotBefore.floor?.doors ?? [])
      .map(door => door.routeConnection?.connectorEdgeId)
      .filter(Boolean)
      .map(String)
  )
  const openEdges = (await sourceFeatures(page, 'floor-route-edges'))
    .filter(feature => !connectorEdgeIds.has(String(feature.properties?.id ?? '')))
  const openEdge = openEdges[openEdges.length - 1]
  const openEdgeId = String(openEdge?.properties?.id ?? '')
  const openEdgeCenter = await featureCenter(page, 'floor-route-edges', openEdgeId)
  await page.mouse.click(openEdgeCenter.x, openEdgeCenter.y)
  await page.waitForSelector('[data-testid="route-connection-prompt"]', { timeout: 5000 })
  await page.getByRole('button', { name: 'Yes', exact: true }).click()
  await sleep(page, 7000)
  const routeEdgesAfter = (await floorSnapshot(page, mapId)).floor?.routeNetwork?.edges?.length ?? 0
  check('Route tool segment finish intentionally connects through a junction', routeEdgesAfter === routeEdgesBefore + 2, { before: routeEdgesBefore, after: routeEdgesAfter })

  await page.getByRole('button', { name: 'Architecture', exact: true }).click()
  await page.getByRole('button', { name: '2.5D', exact: true }).click()
  await sleep(page, 700)
  const mode25 = await page.evaluate(() => ({
    door: Boolean(window.__floorStabilizationMap.getLayer('floor-door-areas-extrusion')),
    stairCount: (() => { const data = window.__floorStabilizationMap.getSource('floor-stair-areas')?._data; return ((data?.features ? data : data?.geojson)?.features ?? []).length })(),
    elevatorCount: (() => { const data = window.__floorStabilizationMap.getSource('floor-elevator-areas')?._data; return ((data?.features ? data : data?.geojson)?.features ?? []).length })(),
  }))
  check('2.5D derives Door/Stair/Elevator visuals from populated 2D footprints', mode25.door && mode25.stairCount === 1 && mode25.elevatorCount === 1, mode25)
  await page.screenshot({ path: `${OUT}/01-25d-populated.png` })
  await page.getByRole('button', { name: '2D', exact: true }).click()
  await sleep(page, 500)
  const doorsIn2d = await sourceFeatures(page, 'floor-door-areas')
  check('switching back to 2D keeps authored objects intact', doorsIn2d.length === 4, doorsIn2d.map((feature) => feature.properties?.id))

  const roomsCollapse = page.getByRole('button', { name: 'Collapse Rooms', exact: true })
  check('Rooms hierarchy exposes collapse control', await roomsCollapse.isVisible())
  await roomsCollapse.click()
  check('Rooms hierarchy collapses', await page.getByRole('button', { name: 'Expand Rooms', exact: true }).isVisible())
  await page.getByRole('button', { name: 'Expand Rooms', exact: true }).click()

  await sleep(page, 7000)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.maplibregl-map', { timeout: 30000 })
  await acquireMap(page)
  // The floor-plan setup modal returns on every load; dismiss it before the
  // semantic tool interactions so the canvas and dock are reachable.
  const continueAfterReload = page.getByRole('button', { name: 'Continue without floor plan', exact: true })
  if (await continueAfterReload.isVisible().catch(() => false)) {
    await continueAfterReload.click()
    await sleep(page, 500)
  }
  await sleep(page, 1800)
  snapshot = await floorSnapshot(page, mapId)
  door = snapshot.floor?.doors?.find((candidate) => candidate.id === doorId)
  check('Door and explicit route relationship survive save/reload', door?.name === 'Browser Main Door' && door?.routeConnection?.targetRouteNodeId === 'route-fixture-1', door)
  const orphanAfterReload = snapshot.floor?.doors?.find((candidate) => candidate.id === 'orphan-door')
  check('orphan Door adoption persists across save/reload', orphanAfterReload?.roomId === 'room-left' && orphanAfterReload?.ownership?.status === 'assigned', orphanAfterReload)
  const duplicateAfterReload = snapshot.floor?.doors?.find((candidate) => candidate.id === duplicateId)
  check('panel duplicate survives save/reload with unchanged ownership and no connection', duplicateAfterReload?.roomId === duplicateDoor?.roomId && duplicateAfterReload?.routeConnection === undefined, duplicateAfterReload)

  // ── Semantic canonical ownership (Task 9 addition 7) ──
  const derivedFaces = await waitForSourceFeatures(page, 'floor-derived-rooms', (features) => features.filter((feature) => typeof feature.properties?.faceId === 'string').length >= 2)
  const faceRows = derivedFaces
    .filter((feature) => typeof feature.properties?.faceId === 'string')
    .map((feature) => {
      const ring = feature.geometry.coordinates[0] ?? []
      const lat = ring.reduce((sum, point) => sum + point[1], 0) / Math.max(ring.length, 1)
      return { faceId: feature.properties.faceId, lat }
    })
    .sort((left, right) => right.lat - left.lat)
  const semanticFaceIdA = faceRows[0]?.faceId
  const semanticFaceIdB = faceRows[1]?.faceId
  check('wall enclosures derive two semantic faces on the disposable floor', Boolean(semanticFaceIdA && semanticFaceIdB) && semanticFaceIdA !== semanticFaceIdB, faceRows)
  const semanticCenterA = await featureCenter(page, 'floor-derived-rooms', semanticFaceIdA)
  const semanticCenterB = await featureCenter(page, 'floor-derived-rooms', semanticFaceIdB)
  if (!semanticCenterA || !semanticCenterB) throw new Error('Semantic face centers were not resolvable')

  await clickTool(page, 'Room')
  await page.mouse.click(semanticCenterA.x, semanticCenterA.y)
  const afterRoomToolDeclaration = await waitForSnapshot(page, mapId, (candidate) => (candidate.floor?.roomAttributes?.length ?? 0) >= 1)
  const semanticAttributeA = afterRoomToolDeclaration.floor?.roomAttributes?.find((attribute) => attribute.faceId === semanticFaceIdA)
  check('Room tool declares the derived face as a canonical semantic Room', Boolean(semanticAttributeA?.roomId), { faceId: semanticFaceIdA, roomId: semanticAttributeA?.roomId })

  const semanticFloorId = await page.evaluate(() => window.__naviContext?.document?.buildings?.[0]?.floors?.[0]?.id ?? null)
  const fallbackDeclaration = await page.evaluate(({ buildingId: building, floorId: targetFloorId, faceId }) => {
    const dispatcher = window.__naviContext?.services?.get('dispatcher')
    const result = dispatcher?.execute({ id: 'roomAttributes.declare', label: 'Declare Room', payload: { buildingId: building, floorId: targetFloorId, faceId, roomId: '', name: 'Fallback Semantic Room' } })
    return result ? { success: result.success, entityId: result.entityId, error: result.error } : null
  }, { buildingId, floorId: semanticFloorId, faceId: semanticFaceIdB })
  const afterFallbackDeclaration = await waitForSnapshot(page, mapId, (candidate) => (candidate.floor?.roomAttributes?.length ?? 0) >= 2)
  const semanticAttributeB = afterFallbackDeclaration.floor?.roomAttributes?.find((attribute) => attribute.faceId === semanticFaceIdB)
  check('attribute-only semantic Room is declared without an explicit roomId', fallbackDeclaration?.success === true && semanticAttributeB?.faceId === semanticFaceIdB, { fallbackDeclaration, attribute: semanticAttributeB })

  await clickTool(page, 'Door')
  const doorIdsBeforeSemanticA = new Set((afterFallbackDeclaration.floor?.doors ?? []).map((candidate) => candidate.id))
  await drag(page, { x: semanticCenterA.x - 20, y: semanticCenterA.y - 20 }, { x: semanticCenterA.x + 20, y: semanticCenterA.y + 20 })
  const semanticDoorAMessage = await page.getByTestId('floor-rectangle-authoring-status').innerText().catch(() => null)
  await page.screenshot({ path: `${OUT}/02-semantic-door-a.png` })
  const afterSemanticDoorA = await waitForSnapshot(page, mapId, (candidate) => (candidate.floor?.doors?.length ?? 0) === doorIdsBeforeSemanticA.size + 1)
  const semanticDoorA = (afterSemanticDoorA.floor?.doors ?? []).find((candidate) => !doorIdsBeforeSemanticA.has(candidate.id))
  check('Door created inside the Room-tool semantic Room receives its canonical id', semanticDoorA?.roomId === semanticAttributeA?.roomId && semanticDoorA?.ownership?.status === 'assigned', { doorRoomId: semanticDoorA?.roomId, ownership: semanticDoorA?.ownership, position: semanticDoorA?.position, declaredRoomId: semanticAttributeA?.roomId, message: semanticDoorAMessage })

  await clickTool(page, 'Door')
  const doorIdsBeforeSemanticB = new Set((afterSemanticDoorA.floor?.doors ?? []).map((candidate) => candidate.id))
  await drag(page, { x: semanticCenterB.x - 20, y: semanticCenterB.y - 20 }, { x: semanticCenterB.x + 20, y: semanticCenterB.y + 20 })
  const semanticDoorBMessage = await page.getByTestId('floor-rectangle-authoring-status').innerText().catch(() => null)
  const afterSemanticDoorB = await waitForSnapshot(page, mapId, (candidate) => (candidate.floor?.doors?.length ?? 0) === doorIdsBeforeSemanticB.size + 1)
  const semanticDoorB = (afterSemanticDoorB.floor?.doors ?? []).find((candidate) => !doorIdsBeforeSemanticB.has(candidate.id))
  check('Door inside an attribute-only semantic Room receives the semantic-room- canonical id', String(semanticDoorB?.roomId ?? '').startsWith('semantic-room-') && semanticDoorB?.roomId === `semantic-room-${semanticFaceIdB}` && semanticDoorB?.ownership?.status === 'assigned', { doorRoomId: semanticDoorB?.roomId, ownership: semanticDoorB?.ownership, position: semanticDoorB?.position, expectedRoomId: `semantic-room-${semanticFaceIdB}`, faceIdB: semanticFaceIdB, message: semanticDoorBMessage })

  // A simulated optimistic-concurrency rejection must preserve the dirty
  // local graph and expose deliberate recovery, never auto-load the server.
  graphPostMode = 'conflict'
  await page.getByText('Browser Main Door', { exact: true }).first().click()
  await page.locator('main input:not([type])').last().fill('Dirty Browser Door')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const recovery = page.getByRole('button', { name: 'Load server version', exact: true })
  await recovery.waitFor({ state: 'visible', timeout: 10000 })
  const conflictSnapshot = await floorSnapshot(page, mapId)
  const dirtyDoor = conflictSnapshot.floor?.doors?.find((candidate) => candidate.id === doorId)
  check('dirty server conflict exposes explicit recovery UI', await recovery.isVisible())
  check('dirty server conflict preserves local authored work', dirtyDoor?.name === 'Dirty Browser Door', dirtyDoor?.name)
  check('browser run has no uncaught page errors', pageErrors.length === 0, pageErrors)
} catch (error) {
  check('browser run completed without uncaught error', false, String(error?.stack ?? error))
  await page.screenshot({ path: `${OUT}/debug-failure.png`, fullPage: true }).catch(() => {})
} finally {
  if (shellCreated) {
    const cleanup = await page.evaluate(async (id) => {
      localStorage.removeItem(`navi-graph-${id}`)
      localStorage.removeItem(`navi-sync-status-${id}`)
      const parsed = JSON.parse(localStorage.getItem('navi-campus-maps') || '{}')
      if (Array.isArray(parsed.maps)) parsed.maps = parsed.maps.filter((map) => map.id !== id)
      if (Array.isArray(parsed.state?.maps)) parsed.state.maps = parsed.state.maps.filter((map) => map.id !== id)
      localStorage.setItem('navi-campus-maps', JSON.stringify(parsed))
      const response = await fetch(`/api/campus-maps?map_id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
      return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) }
    }, mapId).catch((error) => ({ ok: false, error: String(error) }))
    check('disposable campus-map shell removed', cleanup.ok, cleanup)
  }
  await browser.close()
  const failed = results.filter((result) => !result.ok)
  console.log(`\nFLOOR EDITOR BROWSER VALIDATION — ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length}/${results.length})`)
  process.exit(failed.length === 0 ? 0 : 1)
}
