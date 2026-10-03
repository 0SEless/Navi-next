import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  PRODUCTION_OVERRIDE_VAR,
  PRODUCTION_SUPABASE_PROJECT_REF,
  PROTECTED_CAMPUS_IDS,
  assertNotProtectedCampusId,
  assertSafeTestEnvironment,
  detectEffectiveProjectRef,
  requireDisposableTestCampusId,
} from '../e2e/support/safety'

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'navi-safety-'))
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('automated test safety guards', () => {
  it('refuses an unidentified Supabase project (fail closed)', () => {
    expect(() => assertSafeTestEnvironment({}, tmpDir)).toThrow(/could not be identified/)
  })

  it('accepts an explicitly identified non-production project', () => {
    expect(assertSafeTestEnvironment({ SUPABASE_PROJECT_REF: 'test-project' }, tmpDir)).toBe('test-project')
  })

  it('refuses the production project without the explicit override', () => {
    expect(() =>
      assertSafeTestEnvironment({ SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF }, tmpDir),
    ).toThrow(/production Supabase project/)
  })

  it('allows the production project only with the explicit ref override', () => {
    const env = {
      SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
      [PRODUCTION_OVERRIDE_VAR]: PRODUCTION_SUPABASE_PROJECT_REF,
    }
    expect(assertSafeTestEnvironment(env, tmpDir)).toBe(PRODUCTION_SUPABASE_PROJECT_REF)
  })

  it('still requires an explicit campus id when production is overridden', () => {
    const env = {
      SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
      [PRODUCTION_OVERRIDE_VAR]: PRODUCTION_SUPABASE_PROJECT_REF,
    }
    expect(() => requireDisposableTestCampusId(env, tmpDir)).toThrow(/E2E_CAMPUS_ID is required/)
    expect(requireDisposableTestCampusId({ ...env, E2E_CAMPUS_ID: 'e2e-scoped-1' }, tmpDir)).toBe('e2e-scoped-1')
  })

  it('refuses to run without an explicit E2E_CAMPUS_ID', () => {
    const env = { SUPABASE_PROJECT_REF: 'test-project' }
    expect(() => requireDisposableTestCampusId(env, tmpDir)).toThrow(/E2E_CAMPUS_ID is required/)
    expect(() => requireDisposableTestCampusId({ ...env, E2E_CAMPUS_ID: '   ' }, tmpDir)).toThrow(
      /E2E_CAMPUS_ID is required/,
    )
  })

  it('never allows a protected production campus', () => {
    const env = { SUPABASE_PROJECT_REF: 'test-project' }
    for (const campusId of PROTECTED_CAMPUS_IDS) {
      expect(() => requireDisposableTestCampusId({ ...env, E2E_CAMPUS_ID: campusId }, tmpDir)).toThrow(
        /protected production campus/,
      )
      expect(() => assertNotProtectedCampusId(campusId)).toThrow(/protected production campus/)
    }
  })

  it('accepts an explicit disposable campus id', () => {
    expect(
      requireDisposableTestCampusId({ SUPABASE_PROJECT_REF: 'test-project', E2E_CAMPUS_ID: 'e2e-disposable-123' }, tmpDir),
    ).toBe('e2e-disposable-123')
  })

  it('detects a production project from a .env.local fallback', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'navi-envfile-'))
    try {
      writeFileSync(
        path.join(dir, '.env.local'),
        `NEXT_PUBLIC_SUPABASE_URL=https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co\n`,
        'utf8',
      )
      expect(detectEffectiveProjectRef({}, dir)).toBe(PRODUCTION_SUPABASE_PROJECT_REF)
      expect(() => assertSafeTestEnvironment({}, dir)).toThrow(/production Supabase project/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the autosave spec on an explicit campus id (no maps[0] fallback)', () => {
    const spec = readFileSync(path.resolve(process.cwd(), 'e2e', 'autosave-roundtrip.spec.ts'), 'utf8')
    expect(spec).toContain('requireDisposableTestCampusId')
    expect(spec).not.toMatch(/maps\[0\]/)
  })

  it('keeps the POI e2e script from falling back to an existing campus', () => {
    const scriptPath = path.resolve(process.cwd(), 'e2e-unified-poi-area.mjs')
    if (!existsSync(scriptPath)) return // untracked WIP script not present in this checkout
    const script = readFileSync(scriptPath, 'utf8')
    expect(script).not.toMatch(/maps\[0\]\s*\?\?\s*null/)
  })

  it('keeps the .mjs guard in sync with the protected campus and production constants', () => {
    const guard = readFileSync(path.resolve(process.cwd(), 'e2e', 'support', 'campus-guard.mjs'), 'utf8')
    for (const campusId of PROTECTED_CAMPUS_IDS) {
      expect(guard).toContain(campusId)
    }
    expect(guard).toContain(PRODUCTION_SUPABASE_PROJECT_REF)
    expect(guard).toContain(PRODUCTION_OVERRIDE_VAR)
  })

  it('leaves no hardcoded protected campus URL in ad-hoc e2e scripts', () => {
    const scripts = [
      'e2e-p4-verify.mjs',
      'e2e-p4-browser-verify.mjs',
      'e2e-p4-debug-quick.mjs',
      'e2e-p4-find-building.mjs',
      'e2e-p4-find-floor.mjs',
      'e2e-p4-floor-debug.mjs',
      'e2e-p4-navigate-floor.mjs',
      'e2e-p4t6-browser-verification.mjs',
      'e2e-p4t6-debug.mjs',
      'e2e-unified-poi-area.mjs',
    ]
    for (const name of scripts) {
      const full = path.resolve(process.cwd(), name)
      if (!existsSync(full)) continue // untracked WIP script not present in this checkout
      const text = readFileSync(full, 'utf8')
      expect(text, `${name} must not hardcode a protected campus`).not.toMatch(/map-map-1-k6bv/)
    }
  })

  it('requires every playwright-driven .mjs script to import the environment guard', () => {
    const roots = [process.cwd(), path.join(process.cwd(), 'scripts')]
    const offenders: string[] = []
    for (const root of roots) {
      let entries: string[] = []
      try {
        entries = readdirSync(root)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.endsWith('.mjs')) continue
        if (entry === 'campus-guard.mjs') continue
        const full = path.join(root, entry)
        let text = ''
        try {
          text = readFileSync(full, 'utf8')
        } catch {
          continue
        }
        if (!/from 'playwright'/.test(text)) continue
        if (!/campus-guard\.mjs/.test(text)) {
          offenders.push(path.relative(process.cwd(), full))
        }
      }
    }
    expect(offenders, `scripts missing the environment guard import: ${offenders.join(', ')}`).toEqual([])
  })
})
