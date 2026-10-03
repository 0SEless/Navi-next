// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { middleware } from '../middleware'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))

const mockCreate = createServerClient as unknown as ReturnType<typeof vi.fn>
type SessionUser = { id: string; email?: string | null; app_metadata?: Record<string, unknown> | null } | null
let currentUser: SessionUser = null

const makeRequest = (path: string, cookies: Record<string, string> = {}) => {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest('http://localhost' + path, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined)
}

const MOCK_COOKIE_VALUE = Buffer.from(JSON.stringify({ id: 'mock-super-admin', email: 'mock@x.test', role: 'super_admin' })).toString('base64')
const MOCK_VIEWER_COOKIE = Buffer.from(JSON.stringify({ id: 'mock-viewer', email: 'viewer@x.test', role: 'viewer' })).toString('base64')

const expectRedirect = (res: Response, location: string) => {
  expect(res.status, `expected redirect to ${location}`).toBe(307)
  expect(res.headers.get('location')).toBe('http://localhost' + location)
}

describe('middleware admin page authorization (canonical policy)', () => {
  beforeEach(() => {
    currentUser = null
    mockCreate.mockReset().mockImplementation(() => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('unauthenticated: /dashboard and /studio redirect to /login', async () => {
    expectRedirect(await middleware(makeRequest('/dashboard')), '/login')
    expectRedirect(await middleware(makeRequest('/studio/abc/edit')), '/login')
  })

  it('authenticated NON-ADMIN (viewer, no role): admin pages are DENIED (redirect to /)', async () => {
    currentUser = { id: 'u1', email: 'viewer@x.test', app_metadata: {} }
    expectRedirect(await middleware(makeRequest('/dashboard')), '/')
    expectRedirect(await middleware(makeRequest('/studio')), '/')
    expectRedirect(await middleware(makeRequest('/studio/42/edit')), '/')
    expectRedirect(await middleware(makeRequest('/capture')), '/')
  })

  it('public/student routes are unaffected by admin authorization', async () => {
    const res = await middleware(makeRequest('/map/explore'))
    expect(res.status).toBe(200)
  })

  it('verified super_admin: admin pages allowed', async () => {
    currentUser = { id: 'u2', email: 'admin@x.test', app_metadata: { role: 'super_admin' } }
    expect((await middleware(makeRequest('/dashboard'))).status).toBe(200)
    expect((await middleware(makeRequest('/studio/42/edit'))).status).toBe(200)
  })

  it('verified campus_admin: admin pages allowed', async () => {
    currentUser = { id: 'u3', email: 'campus@x.test', app_metadata: { role: 'campus_admin' } }
    expect((await middleware(makeRequest('/dashboard'))).status).toBe(200)
  })

  it('allow-listed email (NAVI_ADMIN_EMAILS) with no role: allowed', async () => {
    vi.stubEnv('NAVI_ADMIN_EMAILS', 'ops@x.test')
    currentUser = { id: 'u4', email: 'OPS@x.test', app_metadata: {} }
    expect((await middleware(makeRequest('/dashboard'))).status).toBe(200)
  })

  it('refresh safety: repeated requests stay denied for non-admin and allowed for admin', async () => {
    currentUser = { id: 'u5', email: 'viewer@x.test', app_metadata: {} }
    expectRedirect(await middleware(makeRequest('/dashboard')), '/')
    expectRedirect(await middleware(makeRequest('/dashboard')), '/')
    currentUser = { id: 'u6', email: 'admin@x.test', app_metadata: { role: 'super_admin' } }
    expect((await middleware(makeRequest('/dashboard'))).status).toBe(200)
  })

  it('login page: admins go to /dashboard, non-admins and guests go safe', async () => {
    currentUser = { id: 'u7', email: 'admin@x.test', app_metadata: { role: 'super_admin' } }
    expectRedirect(await middleware(makeRequest('/login')), '/dashboard')
    currentUser = { id: 'u8', email: 'viewer@x.test', app_metadata: {} }
    expectRedirect(await middleware(makeRequest('/login')), '/')
  })

  it('DEV mock auth (non-production): admin mock allowed, viewer mock denied', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'true')
    expect((await middleware(makeRequest('/dashboard', { 'navi-mock-session': MOCK_COOKIE_VALUE }))).status).toBe(200)
    expectRedirect(await middleware(makeRequest('/dashboard', { 'navi-mock-session': MOCK_VIEWER_COOKIE })), '/')
  })

  it('mock auth can never activate in production runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'true')
    expectRedirect(await middleware(makeRequest('/dashboard', { 'navi-mock-session': MOCK_COOKIE_VALUE })), '/login')
  })
})
