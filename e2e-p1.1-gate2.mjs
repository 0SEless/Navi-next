import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright';

const mapId = 'asu-ibajay';
const url = `http://localhost:3000/studio/${mapId}/edit`;

// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pngBuffer = Buffer.from(PNG_B64, 'base64');

const seedGraph = {
  id: mapId, name: 'Test Campus', center: { lat: 11.0008, lng: 125.0015 }, zoom: 16,
  buildings: [
    {
      id: 'b1', name: 'Building One', code: 'B1', color: '#1C6BEB', height: 30,
      floors: [0, 1],
      footprint: [{ lat: 11.0009, lng: 125.0016 }, { lat: 11.0012, lng: 125.0016 }, { lat: 11.0012, lng: 125.0020 }, { lat: 11.0009, lng: 125.0020 }],
    },
    {
      id: 'b2', name: 'Building Two', code: 'B2', color: '#1C6BEB',
      floors: [0],
      footprint: [{ lat: 11.0007, lng: 125.0021 }, { lat: 11.0010, lng: 125.0021 }, { lat: 11.0010, lng: 125.0025 }, { lat: 11.0007, lng: 125.0025 }],
    },
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
  if (!localStorage.getItem('navi-graph-' + gid)) localStorage.setItem('navi-graph-' + gid, JSON.stringify(graph));
  if (!localStorage.getItem('navi-campus-maps')) localStorage.setItem('navi-campus-maps', JSON.stringify([campus]));
}, { gid: mapId, graph: seedGraph, campus: seedCampus });

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log('=== P1.1 GATE 2 — Floor Plan Upload ===');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__naviDebug && window.__naviDebug.docBuildings > 0, null, { timeout: 20000 }).catch(() => {});

// Select building b1 (Explorer entry)
await page.waitForSelector('text=Building One', { timeout: 10000 }).catch(() => {});
await page.click('text=Building One').catch(() => {});
await page.waitForTimeout(800);

const uploadVisible = await page.evaluate(() => /Floor Plans/i.test(document.body.textContent || ''));
await page.waitForSelector('input[data-floorplan-level="0"]', { timeout: 8000 }).catch(() => {});

// Upload a floor plan for floor 0
await page.setInputFiles('input[data-floorplan-level="0"]', {
  name: 'floor0.png', mimeType: 'image/png', buffer: pngBuffer,
});
await page.waitForTimeout(1800);

const afterUpload = await page.evaluate(() => {
  const fp = window.__naviDebug?.floorPlans || [];
  const b1 = fp.find((b) => b.id === 'b1');
  return { floorPlans: fp, b1Plans: b1 ? b1.plans : null };
});

// Save, then reload and confirm persistence
await page.evaluate(() => window.__naviSave && window.__naviSave());
await page.waitForTimeout(800);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__naviDebug && window.__naviDebug.docBuildings > 0, null, { timeout: 20000 }).catch(() => {});
await page.waitForSelector('text=Building One', { timeout: 10000 }).catch(() => {});
await page.click('text=Building One').catch(() => {});
await page.waitForTimeout(800);
const afterReload = await page.evaluate(() => {
  const fp = window.__naviDebug?.floorPlans || [];
  const b1 = fp.find((b) => b.id === 'b1');
  return { b1Plans: b1 ? b1.plans : null };
});

// Render in floor editor: overlay should be gone (floorPlanUrls[0] present)
await page.goto(`http://localhost:3000/studio/${mapId}/edit/building/b1/floor/0`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const overlayGone = await page.evaluate(() => !/No floor plan/i.test(document.body.textContent || ''));

await page.screenshot({ path: 'e2e-p1.1-gate2.png' });

console.log('Upload UI visible:', uploadVisible);
console.log('After upload b1 plans:', JSON.stringify(afterUpload.b1Plans));
console.log('After reload b1 plans:', JSON.stringify(afterReload.b1Plans));
console.log('Floor editor overlay gone (image present):', overlayGone);
console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE');
console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE');

const pass =
  uploadVisible &&
  Array.isArray(afterUpload.b1Plans) && afterUpload.b1Plans.includes(0) &&
  Array.isArray(afterReload.b1Plans) && afterReload.b1Plans.includes(0) &&
  overlayGone &&
  pageErrors.length === 0;
console.log('GATE 2 PASS:', pass);
await browser.close();
process.exit(pass ? 0 : 1);
