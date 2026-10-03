import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { CampusDocument } from '@navi/core'
import { compile } from '@navi/compiler'
import { publish } from '@navi/compiler/publisher'

const DEPLOY_DIR = 'deploy'

const PROFILES: Record<string, any> = {
  development: { outDir: `${DEPLOY_DIR}/dev`, compilerConfig: { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'none', includeAccessibility: true } },
  production: { outDir: `${DEPLOY_DIR}/prod`, compilerConfig: { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'aggressive', includeAccessibility: true } },
  offline: { outDir: `${DEPLOY_DIR}/offline`, compilerConfig: { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: true } },
  demo: { outDir: `${DEPLOY_DIR}/demo`, compilerConfig: { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false } },
}

function main() {
  const args = process.argv.slice(2)
  const campusPath = args[0]
  const profileName = args[1] ?? 'production'

  if (!campusPath) {
    console.error('Usage: npx tsx scripts/publish.ts <campus.json> [profile]')
    console.error(`Profiles: ${Object.keys(PROFILES).join(', ')}`)
    process.exit(1)
  }

  const profile = PROFILES[profileName]
  if (!profile) {
    console.error(`Unknown profile: ${profileName}. Available: ${Object.keys(PROFILES).join(', ')}`)
    process.exit(1)
  }

  const absPath = resolve(campusPath)
  console.log(`\n  Publishing: ${absPath}`)
  console.log(`  Profile:    ${profileName} → ${profile.outDir}`)

  const json = readFileSync(absPath, 'utf-8')
  const campus: CampusDocument = JSON.parse(json)

  const roomCount = campus.buildings.reduce((s: number, b: any) => s + b.floors.reduce((s2: number, f: any) => s2 + f.rooms.length, 0), 0)
  console.log(`  Compiling:  ${campus.buildings.length} buildings, ${roomCount} rooms`)

  const start = performance.now()
  const result = compile(campus, profile.compilerConfig)
  const compileTime = performance.now() - start
  console.log(`  Compiled:   ${compileTime.toFixed(2)}ms (${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges)`)

  const manifest = publish(campus, result, { outDir: profile.outDir })
  console.log(`  Published:  ${profile.outDir}/`)
  console.log(`    - ${manifest.artifacts.graph.path}`)
  console.log(`    - ${manifest.artifacts.search.path}`)
  console.log(`    - ${manifest.artifacts.buildings.path}`)
  console.log(`    - ${manifest.artifacts.poi.path}`)
  console.log(`    - manifest.json`)
  console.log(`  Done.`)
}

main()
