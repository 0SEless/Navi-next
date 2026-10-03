// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  FIXTURE_TABLES,
  createTestCampusJanitor,
  generateTestCampusId,
  withDisposableTestCampus,
} from '../e2e/support/test-campus.mjs'

const ENV = {
  SUPABASE_PROJECT_REF: 'test-project',
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function okFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return jsonResponse([{ id: 'deleted' }])
    return jsonResponse([])
  })
}

describe('disposable test-campus lifecycle', () => {
  it('refuses to construct when the environment guard rejects the run', () => {
    expect(() =>
      createTestCampusJanitor({
        env: ENV,
        cwd: os.tmpdir(),
        fetchImpl: okFetch(),
        guard: () => {
          throw new Error('guard refused')
        },
      }),
    ).toThrow(/guard refused/)
  })

  it('deletes every fixture table in FK-safe order', async () => {
    const fetchImpl = okFetch()
    const janitor = createTestCampusJanitor({ env: ENV, cwd: os.tmpdir(), fetchImpl, guard: () => 'test-project' })

    const result = await janitor.deleteCampus('e2e-suite-1')

    expect(result.map((entry) => entry.table)).toEqual(FIXTURE_TABLES.map((entry) => entry.table))
    const deleteCalls = fetchImpl.mock.calls.filter((call) => call[1]?.method === 'DELETE')
    expect(deleteCalls).toHaveLength(FIXTURE_TABLES.length)
    for (const [url] of deleteCalls) {
      expect(url).toContain('/rest/v1/')
      expect(url).toContain('eq.e2e-suite-1')
    }
  })

  it('verifies absence across every fixture table', async () => {
    const janitor = createTestCampusJanitor({
      env: ENV,
      cwd: os.tmpdir(),
      fetchImpl: okFetch(),
      guard: () => 'test-project',
    })
    const report = await janitor.assertCampusAbsent('e2e-suite-1')
    expect(report).toHaveLength(FIXTURE_TABLES.length)
    expect(report.every((entry) => entry.rows === 0)).toBe(true)
  })

  it('throws when a cleanup DELETE fails (no silent partial cleanup)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return jsonResponse({ message: 'nope' }, 500)
      return jsonResponse([])
    })
    const janitor = createTestCampusJanitor({ env: ENV, cwd: os.tmpdir(), fetchImpl, guard: () => 'test-project' })
    await expect(janitor.deleteCampus('e2e-suite-1')).rejects.toThrow(/cleanup failed/)
  })

  it('generates explicit disposable ids and never protected-looking defaults', () => {
    const id = generateTestCampusId('suite')
    expect(id).toMatch(/^e2e-suite-[a-z0-9]+-[a-z0-9]+$/)
    expect(id).not.toBe(generateTestCampusId('suite'))
    expect(id).not.toContain('map-map-1-k6bv')
  })

  it('runs the fixture callback and cleans up even when the callback fails', async () => {
    const fetchImpl = okFetch()
    const root = mkdtempSync(path.join(os.tmpdir(), 'navi-fixture-'))
    try {
      await expect(
        withDisposableTestCampus(
          'suite',
          async () => {
            throw new Error('fixture exploded')
          },
          { env: ENV, cwd: root, fetchImpl, guard: () => 'test-project', campusId: 'e2e-suite-fixed' },
        ),
      ).rejects.toThrow(/fixture exploded/)

      const deleteCalls = fetchImpl.mock.calls.filter((call) => call[1]?.method === 'DELETE')
      expect(deleteCalls).toHaveLength(FIXTURE_TABLES.length)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
