import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright';

const mapId = 'asu-ibajay';
const url = `http://localhost:3000/studio/${mapId}/edit`;

const seedGraph = {
  id: mapId, name: 'Test Campus', center: { lat: 11.0008, lng: 125.0015 }, zoom: 16,
  buildings: [
    { id: 'b1', name: 'Building One', code: 'B1', color: '#1C6BEB', height: 30, footprint: [{ lat: 11.0009, lng: 125.0016 }, { lat: 11.0012, lng: 125.0016 }, { lat: 11.0012, lng: 125.0020 }, { lat: 11.0009, lng: 125.0020 }] },
    { id: 'b2', name: 'Building Two', code: 'B2', color: '#1C6BEB', footprint: [{ lat: 11.0007, lng: 125.0021 }, { lat: 11.0010, lng: 125.0021 }, { lat: 11.0010, lng: 125.0025 }, { lat: 11.0007, lng: 125.0025 }] },
    { id: 'b3', name: 'Building Three', code: 'B3', color: '#1C6BEB', footprint: [{ lat: 11.0014, lng: 125.0016 }, { lat: 11.0017, lng: 125.0016 }, { lat: 11.0017, lng: 125.0020 }, { lat: 11.0014, lng: 125.0020 }] },
    { id: 'b4', name: 'Empty Bldg', code: 'B4', color: '#1C6BEB', footprint: [] },
  ],
  ways: [], nodes: [], levels: [], components: [], edges: [],
};

const seedCampus = {
  id: mapId, name: 'Test Campus', description: 'seeded',
  center: { lat: 11.0008, lng: 125.0015 }, zoom: 16,
  stats: { buildings: seedGraph.buildings.length, floors: 0, rooms: 0, nodes: 0, edges: 0, components: 0 },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

const browser = await chromium.launch({ headless: false, args: ['--window-size=1400,900'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

// Gate 0: NO auth cookie set on purpose.
await page.route('**/api/graph', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }));
await page.route('**/api/campus-maps', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ maps: [seedCampus] }) }));

await page.addInitScript(({ gid, graph, campus }) => {
  localStorage.setItem('navi-graph-' + gid, JSON.stringify(graph));
  localStorage.setItem('navi-campus-maps', JSON.stringify([campus]));
}, { gid: mapId, graph: seedGraph, campus: seedCampus });

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log('=== P0 GATE 0+1 (no cookie, correct URL) ===');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const body = await page.evaluate(() => document.body.innerText.slice(0, 200));
const onLogin = /Sign in with Google|MOCK AUTH/.test(body);
const mapNotFound = /Map not found/.test(body);

const state = await page.evaluate(() => {
  const map = window.__naviMap;
  const getCount = (id) => { try { return map.querySourceFeatures(id).length; } catch { return -1; } };
  const c = map?.getCenter?.();
  let firstHeight = null;
  try { const f = map.querySourceFeatures('s-buildings'); firstHeight = f.length ? f[0].properties?.height ?? null : null; } catch {}
  const dbg = window.__naviDebug || null;
  const sourceIds = map ? Object.keys(map.getStyle().sources || {}) : [];
  return { hasMap: !!map, buildingFeatures: getCount('s-buildings'), outline: getCount('l-buildings-outline'), firstHeight, debug: dbg, sourceIds, center: c ? { lng: +c.lng.toFixed(6), lat: +c.lat.toFixed(6) } : null };
});

await page.screenshot({ path: 'e2e-p0-gate0.png' });
console.log('On login page:', onLogin, '| Map not found:', mapNotFound);
console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE');
console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE');
console.log('Map state:', JSON.stringify(state));
console.log('EXPECT: onLogin=false, hasMap=true, buildingFeatures=3, firstHeight=30 (not 10), center≈{lng:125.0015,lat:11.0008}');

await browser.close();
