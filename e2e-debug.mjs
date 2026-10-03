import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright';

const mapId = 'asu-ibajay';
const url = `http://localhost:3000/studio/map/${mapId}`;

const seedGraph = { id: mapId, name: 'Test Campus', center: { lat: 11.0008, lng: 125.0015 }, zoom: 16, buildings: [{ id: 'b1', name: 'B1', code: 'B1', color: '#1C6BEB', footprint: [{ lat: 11.0009, lng: 125.0016 }, { lat: 11.0012, lng: 125.0016 }, { lat: 11.0012, lng: 125.0020 }, { lat: 11.0009, lng: 125.0020 }] }], ways: [], nodes: [], levels: [], components: [], edges: [] };
const seedCampus = { id: mapId, name: 'Test Campus', center: { lat: 11.0008, lng: 125.0015 }, zoom: 16, stats: { buildings: 1 }, createdAt: '', updatedAt: '' };

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

await page.route('**/api/graph', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }));
await page.route('**/api/campus-maps', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ maps: [seedCampus] }) }));

page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).split('\n').slice(0,3).join(' | ')));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));

await page.addInitScript(({ gid, graph, campus }) => {
  localStorage.setItem('navi-graph-' + gid, JSON.stringify(graph));
  localStorage.setItem('navi-campus-maps', JSON.stringify([campus]));
}, { gid: mapId, graph: seedGraph, campus: seedCampus });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const info = await page.evaluate(() => ({
  hasMap: !!window.__naviMap,
  canvas: document.querySelectorAll('canvas').length,
  bodyText: document.body.innerText.slice(0, 400),
  overlay: document.querySelector('nextjs-portal') ? 'HAS nextjs-portal' : 'no portal',
}));
console.log('INFO', JSON.stringify(info, null, 2));
await page.screenshot({ path: 'e2e-debug.png' });
await browser.close();
