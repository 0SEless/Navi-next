import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import * as editor from '@navi/editor'

// P1-T12 (R4.2/D5): the calibration panel and tool are deleted entirely.
// Symbol checks are RED while any calibration code exists; the scan covers
// editor production sources only (the deleted tests are gone with them).

/** Package-relative path under ANY vitest cwd (package dir or repo root). */
function resolvePackage(pkg: string, rel: string): string {
  const candidates = [
    resolve(process.cwd(), 'packages', pkg, rel),
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '../..', 'packages', pkg, rel),
  ]
  for (const c of candidates) {
    try {
      readdirSync(c)
      return c
    } catch {
      // try next candidate
    }
  }
  return candidates[0]
}

const EDITOR_SRC = resolvePackage('editor', 'src')

function collectSrcFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) acc = collectSrcFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe('P1-T12: calibration panel/tool deleted (R4.2)', () => {
  it('@navi/editor no longer exports calibration panel or tool symbols', () => {
    const exported = Object.keys(editor)
    expect(exported).not.toContain('CalibrationPanel')
    expect(exported).not.toContain('calibrationTool')
    expect(exported).not.toContain('computeCalibration')
    expect(exported).not.toContain('addControlPoint')
    expect(exported).not.toContain('createEmptyState')
  })

  it('no calibration references remain in editor production sources (unit symbol check)', () => {
    const files = collectSrcFiles(EDITOR_SRC)
    const violations: string[] = []
    for (const file of files) {
      if (file.endsWith('calibration-symbols.test.ts')) continue
      const content = readFileSync(file, 'utf8')
      if (/calibration/i.test(content)) violations.push(file.replace(EDITOR_SRC, 'editor/'))
    }
    expect(violations).toEqual([])
  })

  it('the calibration panel and tool files no longer exist', () => {
    const panels = readdirSync(join(EDITOR_SRC, 'panels'))
    expect(panels).not.toContain('CalibrationPanel.tsx')
    expect(panels).not.toContain('calibration-tool.ts')
    const coreCoords = readdirSync(resolvePackage('core', 'src/coordinates'))
    expect(coreCoords).not.toContain('calibration.ts')
  })
})