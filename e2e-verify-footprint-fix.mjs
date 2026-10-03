import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright';

const mapId = 'asu-ibajay';
const url = `http://localhost:3000/studio/map/${mapId}`;

const seedGraph = {
  id: mapId, name: 'Test Campus', center: { lat: 11.0008, lng: 125.0015 }, zoom: 16,
  buildings: [
    { id: 'b1', name: 'Building One', code: 'B1', color: '#1C6BEB', footprint: [{ lat: 11.0009, lng: 125.0016 }, { lat: 11.0012, lng: 125.0016 }, { lat: 11.0012, lng: 125.0020 }, { lat: 11.0009, lng: 125.0020 }] },
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
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log('=== VERIFY FOOTPRINT FIX (headed, isolated) ===');
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const toolResults = [];
for (const t of ['select', 'pan', 'draw-road', 'draw-building']) {
  try {
    await page.getByRole('button', { name: new RegExp(t, 'i') }).first().click();
    await page.waitForTimeout(300);
    toolResults.push(`${t}: ok`);
  } catch (e) {
    toolResults.push(`${t}: FAIL ${e.message.split('\n')[0]}`);
  }
}

const state = await page.evaluate(() => {
  const map = window.__naviMap;
  const getCount = (id) => {
    try { const s = map?.getSource(id); return s ? s._data?.features?.length ?? 0 : -1; } catch { return -1; }
  };
  const c = map?.getCenter?.();
  return {
    hasMap: !!map,
    buildingFeatures: getCount('s-buildings'),
    outlineFeatures: getCount('l-buildings-outline'),
    center: c ? { lng: +c.lng.toFixed(6), lat: +c.lat.toFixed(6) } : null,
  };
});

await page.screenshot({ path: 'e2e-shot-footprint-fix.png' });
console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE');
console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE');
console.log('Tool results:', toolResults);
console.log('Map state:', JSON.stringify(state));
console.log('EXPECT: buildingFeatures=3, outlineFeatures=3, center.lat≈11.0008, center.lng≈125.0015');

await browser.close();
