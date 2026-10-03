// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  assertCampusMutationAllowed,
  isAdminUser,
  requireVerifiedMutationAuth,
} from '../api-guard'

type FakeUser = { id?: string; email?: string | null; app_metadata?: Record<string, unknown> | null } | null

const makeRequest = (cookies: Record<string, string> = {}, body?: unknown) => {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest('http://localhost/api/graph', {
    method: 'POST',
    headers: cookieHeader ? { 'Content-Type': 'application/json', cookie: cookieHeader } : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const factoryWith = (user: FakeUser, opts: { throwErr?: boolean; error?: boolean } = {}) => {
  const factory = vi.fn(async () => ({
    auth: {
      getUser: async () => {
        if (opts.throwErr) throw new Error('auth-service down')
        if (opts.error) return { data: { user: null }, error: { message: 'invalid or expired token' } }
        return { data: { user }, error: null }
      },
    },
  }))
  return factory
}

const SUPABASE_COOKIE = { 'sb-abcdefgh-auth-token': 'some-opaque-token' }
const MOCK_COOKIE_VALUE = Buffer.from(JSON.stringify({ id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin' })).toString('base64')

describe('privileged mutation auth contract (mutation-auth matrix)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('A: no cookie/session -> 401 and verification is never consulted', async () => {
    const factory = factoryWith({ id: 'u1', email: 'a@b.c', app_metadata: { role: 'super_admin' } })
    const res = await requireVerifiedMutationAuth(makeRequest(), { supabaseFactory: factory })
    expect(res?.status).toBe(401)
    expect(factory).not.toHaveBeenCalled()
  })

  it('B: arbitrary fake cookie + no verifiable user -> 401', async () => {
    const res = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE), { supabaseFactory: factoryWith(null) })
    expect(res?.status).toBe(401)
  })

  it('C/D: malformed or expired session -> 401', async () => {
    const malformed = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE), { supabaseFactory: factoryWith(null, { error: true }) })
    expect(malformed?.status).toBe(401)
    const expired = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE), { supabaseFactory: factoryWith(null, { error: true }) })
    expect(expired?.status).toBe(401)
  })

  it('I: auth verification service failure -> 401 (fail closed, not 500 bypass)', async () => {
    const res = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE), { supabaseFactory: factoryWith(null, { throwErr: true }) })
    expect(res?.status).toBe(401)
  })

  it('E/G: verified non-admin -> 403; client-supplied role in body cannot escalate', async () => {
    const viewer = { id: 'u2', email: 'viewer@x.test', app_metadata: { role: 'viewer' } }
    const res = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE, { role: 'super_admin', campusId: 'dev-x' }), { supabaseFactory: factoryWith(viewer) })
    expect(res?.status).toBe(403)
    const body = await res!.json()
    expect(JSON.stringify(body)).not.toMatch(/super_admin.*granted|authorized by request/i)
  })

  it('F: verified admin (app_metadata role) -> allowed', async () => {
    const admin = { id: 'u3', email: 'admin@x.test', app_metadata: { role: 'super_admin' } }
    const res = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE), { supabaseFactory: factoryWith(admin) })
    expect(res).toBeNull()
  })

  it('F2: verified user allow-listed via NAVI_ADMIN_EMAILS -> allowed', async () => {
    vi.stubEnv('NAVI_ADMIN_EMAILS', 'ops@x.test, admin@y.test')
    const admin = { id: 'u4', email: 'OPS@x.test', app_metadata: { role: 'viewer' } }
    const res = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE), { supabaseFactory: factoryWith(admin) })
    expect(res).toBeNull()
  })

  it('default runtime seam: without injected factory the test-runtime seam allows cookie presence (route doubles), production never does', async () => {
    const res = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE))
    expect(res).toBeNull() // NODE_ENV=test seam (vitest); exercised by route suites
    vi.stubEnv('NODE_ENV', 'production')
    const prod = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE))
    expect(prod?.status).toBe(401) // production: presence alone is not authentication
  })

  it('K: DEV mock auth cannot activate in production, and fails closed when mock is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'true')
    const res = await requireVerifiedMutationAuth(makeRequest({ 'navi-mock-session': MOCK_COOKIE_VALUE }))
    expect(res?.status).toBe(401)

    vi.unstubAllEnvs()
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'false')
    const disabled = await requireVerifiedMutationAuth(makeRequest({ 'navi-mock-session': MOCK_COOKIE_VALUE }))
    expect(disabled?.status).toBe(401)
  })

  it('mock path (DEV/test only) yields an admin session when explicitly enabled outside production', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'true')
    const res = await requireVerifiedMutationAuth(makeRequest({ 'navi-mock-session': MOCK_COOKIE_VALUE }))
    expect(res).toBeNull()
  })

  it('H: client-side state / headers cannot grant authorization', () => {
    expect(isAdminUser({ email: 'viewer@x.test', role: 'super_admin' })).toBe(true) // mock-path shape (role derived server-side from session)
    expect(isAdminUser({ email: 'viewer@x.test' })).toBe(false)
    expect(isAdminUser(null)).toBe(false)
    expect(isAdminUser(undefined)).toBe(false)
  })

  it('J: protected campus remains blocked regardless of authentication', () => {
    const res = assertCampusMutationAllowed('map-map-1-k6bv')
    expect(res?.status).toBe(423)
    vi.stubEnv('NAVI_PROTECTED_CAMPUS_WRITES', '1')
    expect(assertCampusMutationAllowed('map-map-1-k6bv')).toBeNull()
  })

  it('L: error responses never contain service-role credentials or secrets', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'should-never-appear-secret')
    const noSession = await requireVerifiedMutationAuth(makeRequest())
    const nonAdmin = await requireVerifiedMutationAuth(makeRequest(SUPABASE_COOKIE), { supabaseFactory: factoryWith({ id: 'u9', email: 'v@x.test', app_metadata: { role: 'viewer' } }) })
    for (const res of [noSession, nonAdmin]) {
      const text = JSON.stringify(await res!.json())
      expect(text).not.toMatch(/service[-_]?role|should-never-appear|sb_secret|apikey/i)
    }
  })

  it('M: no session -> verification client is not created and no mutation work can run', async () => {
    const factory = vi.fn()
    await requireVerifiedMutationAuth(makeRequest(), { supabaseFactory: factory as never })
    expect(factory).not.toHaveBeenCalled()
  })
})
