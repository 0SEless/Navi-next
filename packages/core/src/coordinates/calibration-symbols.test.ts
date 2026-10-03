import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import * as core from '@navi/core'

// P1-T12 (R4.2/D5): the calibration subsystem is deleted entirely. These
// symbol checks are RED while any calibration code exists and GREEN only
// after removal — calibration must never be reintroduced.

/** Package-relative path under ANY vitest cwd (package dir or repo root). */
function resolvePackage(pkg: string, rel: string): string {
  const candidates = [
    resolve(process.cwd(), 'packages', pkg, rel),
    resolve(process.cwd(), rel),
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

const CORE_SRC = resolvePackage('core', 'src')

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) acc = collectTsFiles(full, acc)
    else if (entry.name.endsWith('.ts')) acc.push(full)
  }
  return acc
}

describe('P1-T12: calibration subsystem deleted (R4.2)', () => {
  it('@navi/core no longer exports any calibration symbols', () => {
    const exported = Object.keys(core)
    expect(exported).not.toContain('CalibrationEngine')
    expect(exported).not.toContain('FloorCalibration')
    expect(exported).not.toContain('CalibrationResult')
    expect(exported).not.toContain('ControlPoint')
  })

  it('no calibration module or references remain anywhere in core/src (unit symbol check)', () => {
    const files = collectTsFiles(CORE_SRC)
    const violations: string[] = []
    for (const file of files) {
      if (file.endsWith('calibration-symbols.test.ts')) continue
      const content = readFileSync(file, 'utf8')
      if (/calibration/i.test(content)) violations.push(file.replace(CORE_SRC, 'core/'))
    }
    expect(violations).toEqual([])
  })

  it('the calibration module file no longer exists', () => {
    expect(readdirSync(CORE_SRC).some(f => f === 'calibration.ts')).toBe(false)
  })
})