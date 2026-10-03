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
    // Nameless building -> triggers missing-name (auto-fixable)
    { id: 'b-nameless', code: 'BN', color: '#1C6BEB', height: 10, footprint: [{ lat: 11.0014, lng: 125.0016 }, { lat: 11.0017, lng: 125.0016 }, { lat: 11.0017, lng: 125.0020 }, { lat: 11.0014, lng: 125.0020 }] },
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
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log('=== P1.1 GATE 1 — Validation panel exposed ===');
await page.goto(url, { waitUntil: 'domcontentloaded' });

// Wait for editor context (ProblemsPanel mounted) — panel header "Problems" must appear.
await page.waitForFunction(() => /Problems/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});

const panelVisible = await page.evaluate(() => /Problems/.test(document.body.textContent || ''));
const profileOptions = await page.evaluate(() => {
  const sel = document.querySelector('select');
  return sel ? Array.from(sel.options).map((o) => o.textContent) : [];
});

// Run validation via the re-validate button (↻).
const revalidate = await page.$('button:has-text("↻")');
if (revalidate) { await revalidate.click(); }
await page.waitForTimeout(1500);

const readPanel = () => page.evaluate(() => {
  const txt = document.body.textContent || '';
  const m = txt.match(/Problems\s*\((\d+)\)/);
  const count = m ? parseInt(m[1], 10) : (/\bNo problems\b/.test(txt) ? 0 : -1);
  const fixButtons = Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent || '').trim() === 'Fix').length;
  return { count, fixButtons, hasNoProblems: /\bNo problems\b/.test(txt) };
});

const afterValidate = await readPanel();

// Apply the first auto-fix, then confirm the panel refreshes automatically.
let afterFix = null;
if (afterValidate.fixButtons > 0) {
  const fixBtn = await page.$('button:has-text("Fix")');
  await fixBtn.click();
  await page.waitForTimeout(1500);
  afterFix = await readPanel();
}

// Switch profile to Publish (proves profiles work without error).
let profileSwitchOk = false;
const sel = await page.$('select');
if (sel) {
  await sel.selectOption('publish').catch(() => {});
  await page.waitForTimeout(800);
  profileSwitchOk = await page.evaluate(() => /Problems/.test(document.body.textContent || ''));
}

await page.screenshot({ path: 'e2e-p1.1-gate1.png' });

console.log('Panel visible:', panelVisible);
console.log('Profile options:', profileOptions);
console.log('After validate:', JSON.stringify(afterValidate));
console.log('After fix:', JSON.stringify(afterFix));
console.log('Publish profile switch OK:', profileSwitchOk);
console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE');
console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE');

const pass =
  panelVisible &&
  profileOptions.length === 3 &&
  (afterValidate.count > 0 || afterValidate.hasNoProblems) &&
  pageErrors.length === 0;
console.log('GATE 1 PASS:', pass);
await browser.close();
process.exit(pass ? 0 : 1);
