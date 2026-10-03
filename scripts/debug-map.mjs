import { requireSafeTestEnvironment } from '../e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const logs = [];
page.on('console', msg => logs.push(msg.type() + ': ' + msg.text()));
page.on('pageerror', err => logs.push('PAGE_ERROR: ' + err.message));

// First, load homepage to populate localStorage from Supabase
await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);

// Get the map ID from localStorage
const mapId = await page.evaluate(() => {
  const raw = localStorage.getItem('navi-campus-maps');
  if (raw) {
    const data = JSON.parse(raw);
    return data.maps?.[0]?.id || null;
  }
  return null;
});

console.log('Map ID:', mapId);

if (!mapId) {
  console.log('No map found in localStorage');
  await browser.close();
  process.exit(0);
}

// Navigate to the edit page
const logs2 = [];
page.on('console', msg => logs2.push(msg.type() + ': ' + msg.text()));
page.on('pageerror', err => logs2.push('PAGE_ERROR: ' + err.message));

await page.goto(`http://localhost:3000/studio/${mapId}/edit`, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(5000);

const dims = await page.evaluate(() => {
  const mapContainer = document.querySelector('.maplibregl-map');
  const mapCanvas = document.querySelector('.maplibregl-canvas');
  const studioCanvas = document.querySelector('[style*="position: relative"][style*="width: 100%"][style*="height: 100%"]');
  
  // Check all elements with height: 100%
  const allDivs = Array.from(document.querySelectorAll('div'));
  const height100 = allDivs.filter(d => d.style.height === '100%').map(d => ({
    w: d.clientWidth,
    h: d.clientHeight,
    rect: d.getBoundingClientRect(),
  }));

  // Find the studio canvas parent chain
  let el = mapContainer?.parentElement;
  const chain = [];
  while (el && chain.length < 15) {
    const rect = el.getBoundingClientRect();
    chain.push({
      tag: el.tagName,
      cls: (el.className || '').substring(0, 80),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      style: (el.style?.cssText || '').substring(0, 120),
    });
    el = el.parentElement;
  }
  
  return {
    mapContainer: mapContainer ? { w: mapContainer.clientWidth, h: mapContainer.clientHeight } : null,
    mapCanvas: mapCanvas ? { w: mapCanvas.width, h: mapCanvas.height } : null,
    height100Divs: height100,
    parentChain: chain,
    url: window.location.href,
  };
});

console.log('=== CONSOLE LOGS ===');
logs2.forEach(l => console.log(l));
console.log('=== DOM STATE ===');
console.log(JSON.stringify(dims, null, 2));

await browser.close();
