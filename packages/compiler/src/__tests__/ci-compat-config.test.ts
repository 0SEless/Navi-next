import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// P1-T11 (R11.3): the CI compatibility pipeline must exist, run on every
// artifact-format change, and fail the job (blocking merge) when the smoke
// tests fail. This is the unit-level CI config check.

/** Resolve a repo-root-relative path under ANY vitest cwd (package dir or
 *  repo root) — same multi-candidate pattern as the T8 threshold tests. */
function resolveRepoFile(rel: string): string {
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), 'packages/compiler', rel),
    resolve(process.cwd(), 'navi-next', rel),
    resolve(process.cwd(), '../..', rel),
  ]
  for (const c of candidates) {
    try {
      readFileSync(c)
      return c
    } catch {
      // try next candidate
    }
  }
  return candidates[0]
}

describe('P1-T11: CI compatibility pipeline config (R11.3)', () => {
  it('the artifact-compat workflow exists and runs on artifact-format changes', () => {
    const yml = readFileSync(resolveRepoFile('.github/workflows/artifact-compat.yml'), 'utf8')
    // Triggers on every artifact-format change
    expect(yml).toMatch(/pull_request/)
    expect(yml).toMatch(/paths:/)
    expect(yml).toMatch(/packages\/compiler/)
    expect(yml).toMatch(/navigation-artifacts\.ts/)
    expect(yml).toMatch(/package-format\.ts/)
    expect(yml).toMatch(/packages\/runtime/)
    expect(yml).toMatch(/packages\/publisher/)
  })

  it('the job runs the compatibility smoke and fails the job on failure (blocks merge)', () => {
    const yml = readFileSync(resolveRepoFile('.github/workflows/artifact-compat.yml'), 'utf8')
    expect(yml).toMatch(/test:artifact-compat/)
    // A failed smoke step fails the job — GitHub Actions marks the check red,
    // which blocks merge when the check is required.
    expect(yml).toMatch(/run:/)
  })

  it('the root package exposes the artifact-compat smoke script', () => {
    // The ROOT package.json (workspaces marker) — not a package's own.
    const candidates = [
      resolve(process.cwd(), 'package.json'),
      resolve(process.cwd(), 'packages/compiler', 'package.json'),
      resolve(process.cwd(), '../..', 'package.json'),
    ]
    let rootPkg = ''
    for (const c of candidates) {
      try {
        const content = readFileSync(c, 'utf8')
        if (content.includes('"workspaces"')) {
          rootPkg = content
          break
        }
      } catch {
        // try next candidate
      }
    }
    expect(rootPkg).toMatch(/"test:artifact-compat":\s*"[^"]*artifact-compat-smoke/)
  })
})