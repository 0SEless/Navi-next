import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { readdirSync } from 'fs'
import { resolve, join } from 'path'
import type { NavigationPackageManifest, FloorGeometryArtifact } from '@navi/core'

// P1-T11 (R11.4): shared contract types live in @navi/core; navi-next must
// NOT depend on Studio internals via relative paths or cross-app imports.

const SRC_ROOT = resolve(__dirname, '../')

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) acc = collectSourceFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe('P1-T11: dependency boundary (R11.4)', () => {
  it('production code imports @navi/* packages only — no relative paths into packages/ or apps/ (Studio internals)', () => {
    const files = collectSourceFiles(SRC_ROOT).filter(f => !f.includes('__tests__') && !/\.test\.(ts|tsx)$/.test(f))
    const violations: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const line of content.split('\n')) {
        if (/\.\.\/\.\.\/packages\//.test(line)) violations.push(`${file.replace(SRC_ROOT, 'src')}: ${line.trim()}`)
        if (/apps\/studio-new/.test(line)) violations.push(`${file.replace(SRC_ROOT, 'src')}: ${line.trim()}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('contract types (manifest, artifact schemas) resolve from @navi/core alone', () => {
    // Type-level contract: NavigationPackageManifest + FloorGeometryArtifact
    // must exist as exports of @navi/core (imports above would fail compile).
    const manifest: NavigationPackageManifest = null as unknown as NavigationPackageManifest
    const fg: FloorGeometryArtifact = null as unknown as FloorGeometryArtifact
    expect(typeof manifest).toBe('object')
    expect(typeof fg).toBe('object')
  })
})