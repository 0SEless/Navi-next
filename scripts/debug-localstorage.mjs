import { requireSafeTestEnvironment } from '../e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://localhost:3000/studio/map-1783994563934-02fbn/preview', { waitUntil: 'domcontentloaded', timeout: 15000 })
await page.waitForTimeout(3000)

const data = await page.evaluate(() => {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i))
  const storage = {}
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k)
      if (raw && (k.includes('navi-graph') || k.includes('campus-map') || k.includes('navi-sync'))) {
        storage[k] = JSON.parse(raw) 
      }
    } catch {}
  }
  // Graph buildings count
  const graphKey = Object.keys(storage).find(k => k.startsWith('navi-graph-'))
  const buildings = graphKey ? (storage[graphKey]?.buildings ?? []) : []
  return {
    keys,
    graphKey,
    hasStorage: storage[graphKey] ? true : false,
    buildingCount: buildings.length,
    buildings: buildings.map(b => ({
      id: b.id,
      name: b.name,
      footprintType: typeof b.footprint,
      footprintIsArray: Array.isArray(b.footprint),
      footprintPoints: b.footprint?.points?.length ?? null,
      footprintLength: b.footprint?.length ?? null,
      center: b.center,
      height: b.height,
    })),
    nodesCount: storage[graphKey]?.nodes?.length ?? 0,
    edgesCount: storage[graphKey]?.edges?.length ?? 0,
  }
})

const lines = [
  `=== localStorage diagnosis ===`,
  `Keys: ${data.keys.join(', ')}`,
  `Graph key: ${data.graphKey}`,
  `Has graph storage: ${data.hasStorage}`,
  `Buildings: ${data.buildingCount}`,
  `Nodes: ${data.nodesCount}`,
  `Edges: ${data.edgesCount}`,
]
if (data.buildings.length > 0) {
  lines.push(`\n--- Building details ---`)
  for (const b of data.buildings) {
    lines.push(`${b.id} "${b.name}" | footprint type=${b.footprintType} isArray=${b.footprintIsArray} pts=${b.footprintPoints ?? b.footprintLength} height=${b.height}`)
  }
} else {
  lines.push(`\nNO BUILDINGS IN STORAGE`)
}

writeFileSync('scripts/debug-storage.txt', lines.join('\n'))
console.log(lines.join('\n'))
await browser.close()
