#!/usr/bin/env node
/**
 * Layer boundary gate — architectural linter for NAVI.
 *
 * Ensures composition services never import forbidden modules.
 * Can grow into a full architectural layer linter.
 *
 * Usage: node scripts/check-layer-boundaries.mjs
 * Exit code 0 = pass, non-zero = violations found.
 */

import { readFileSync, existsSync, globSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const COMPOSITION_DIR = join(ROOT, 'packages/runtime/src/composition')

// Patterns that composition services MUST NOT import.
const FORBIDDEN_PATTERNS = [
  // Pipeline layers
  /['"]\.\.\/loader\b/,
  /['"]@navi\/compiler/,
  /['"]@navi\/publisher/,

  // Artifact / index / graph types (imported by name)
  /["']LoadedPackage["']/,
  /["']NavigationGraph["']/,
  /["']SearchIndex["']/,
  /["']BuildingIndex["']/,
  /["']PanoramaIndex["']/,
  /["']POIIndex["']/,
  /["']BuildingEntry["']/,

  // Viewer / UI / platform
  /pannellum/,
  /marzipano/,
  /maplibre/,
  /["']react["']/,
  /["']react-dom["']/,
  /["']next["']/,
]

function testPattern(content, pattern) {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Only check import lines
    if (line.includes('import ') || line.includes('require(')) {
      const m = line.match(pattern)
      if (m) return { line: i + 1, text: m[0].replace(/['"]/g, '') }
    }
  }
  return null
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const violations = []

  for (const pattern of FORBIDDEN_PATTERNS) {
    const hit = testPattern(content, pattern)
    if (hit) {
      violations.push({ line: hit.line, import: hit.text })
    }
  }

  return violations
}

function main() {
  if (!existsSync(COMPOSITION_DIR)) {
    console.log('✓ composition directory not found — skipping gate')
    process.exit(0)
  }

  const files = globSync('**/*.ts', { cwd: COMPOSITION_DIR })
    .filter(f => !f.includes('__tests__'))

  if (files.length === 0) {
    console.log('✓ no composition source files to check')
    process.exit(0)
  }

  let allViolations = []

  for (const file of files) {
    const fullPath = join(COMPOSITION_DIR, file)
    const violations = checkFile(fullPath)
    if (violations.length > 0) {
      console.error(`\n❌ ${file}:`)
      for (const v of violations) {
        console.error(`   line ${v.line}: forbidden import "${v.import}"`)
      }
      allViolations.push(...violations)
    }
  }

  if (allViolations.length > 0) {
    console.error(`\n❌ Layer boundary violation: ${allViolations.length} forbidden import(s) in composition/`)
    console.error('   Composition services may import only: RuntimeEngine, domain DTOs (@navi/core), other composition services.')
    console.error('   Forbidden: LoadedPackage, artifact/index types, compiler/*, publisher/*, loader/*, viewer libraries.')
    process.exit(1)
  }

  console.log(`✓ layer boundaries clean (${files.length} files checked)`)
  process.exit(0)
}

main()
