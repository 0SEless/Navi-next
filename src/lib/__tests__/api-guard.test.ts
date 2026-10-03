// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  PROTECTED_CAMPUS_IDS,
  PROTECTED_CAMPUS_WRITE_OVERRIDE_VAR,
  assertCampusMutationAllowed,
  getCampusIdFromBody,
  getMutationSessionMethod,
  requireMutationSession,
} from '../api-guard'

const MOCK_USER = {
  id: 'mock-super-admin',
  name: 'Dr. Admin',
  email: 'admin@asu.edu',
  role: 'super_admin',
  campus_id: null,
}

function encodeMockCookie(user: unknown = MOCK_USER): string {
  return Buffer.from(JSON.stringify(user)).toString('base64')
}

function cookieHeader(entries: Record<string, string>): Record<string, string> {
  return {
    cookie: Object.entries(entries)
      .map(([name, value]) => `${name}=${value}`)
      .join('; '),
  }
}

function makePost(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/graph', {
    method: 'POST',
    headers,
    body: '{}',
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('requireMutationSession', () => {
  it('no session → 401 with the exact fail-closed body', async () => {
    const res = requireMutationSession(makePost())
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    expect(await res!.json()).toEqual({ error: 'Authentication required.' })
  })

  it('unrelated cookie only → 401', () => {
    const res = requireMutationSession(makePost(cookieHeader({ theme: 'dark' })))
    expect(res?.status).toBe(401)
  })

  it('mock cookie + NEXT_PUBLIC_MOCK_AUTH=true → allowed as mock session', () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'true')
    const request = makePost(cookieHeader({ 'navi-mock-session': encodeMockCookie() }))
    expect(requireMutationSession(request)).toBeNull()
    expect(getMutationSessionMethod(request)).toBe('mock')
  })

  it('mock cookie + invalid payload → 401 (fail closed)', () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'true')
    const res = requireMutationSession(makePost(cookieHeader({ 'navi-mock-session': 'not-base64-json' })))
    expect(res?.status).toBe(401)
  })

  it('mock cookie while mock auth is disabled → 401', () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'false')
    const res = requireMutationSession(makePost(cookieHeader({ 'navi-mock-session': encodeMockCookie() })))
    expect(res?.status).toBe(401)
  })

  it('supabase auth cookie → allowed even when mock auth is off', () => {
    vi.stubEnv('NEXT_PUBLIC_MOCK_AUTH', 'false')
    const request = makePost(cookieHeader({ 'sb-abcdef-auth-token': 'jwt-payload' }))
    expect(requireMutationSession(request)).toBeNull()
    expect(getMutationSessionMethod(request)).toBe('supabase')
  })

  it('chunked supabase auth cookie → allowed', () => {
    const request = makePost(
      cookieHeader({
        'sb-abcdef-auth-token.0': 'chunk-0',
        'sb-abcdef-auth-token.1': 'chunk-1',
      }),
    )
    expect(requireMutationSession(request)).toBeNull()
  })

  it('empty supabase auth cookie value → 401', () => {
    const res = requireMutationSession(makePost(cookieHeader({ 'sb-abcdef-auth-token': '' })))
    expect(res?.status).toBe(401)
  })
})

describe('assertCampusMutationAllowed', () => {
  it('protects every id in PROTECTED_CAMPUS_IDS with 423 and the exact body', async () => {
    expect(PROTECTED_CAMPUS_IDS.length).toBeGreaterThan(0)
    for (const campusId of PROTECTED_CAMPUS_IDS) {
      const res = assertCampusMutationAllowed(campusId)
      expect(res).not.toBeNull()
      expect(res!.status).toBe(423)
      expect(await res!.json()).toEqual({
        error: 'This campus is protected. Mutations are disabled.',
      })
    }
  })

  it('allows an unprotected campus', () => {
    expect(assertCampusMutationAllowed('map-map-1-9o9z')).toBeNull()
  })

  it('allows missing/empty/non-string campus ids so route validation can respond', () => {
    expect(assertCampusMutationAllowed(undefined)).toBeNull()
    expect(assertCampusMutationAllowed(null)).toBeNull()
    expect(assertCampusMutationAllowed('')).toBeNull()
    expect(assertCampusMutationAllowed(42)).toBeNull()
  })

  it(`override: ${PROTECTED_CAMPUS_WRITE_OVERRIDE_VAR}=1 allows the protected campus`, () => {
    vi.stubEnv(PROTECTED_CAMPUS_WRITE_OVERRIDE_VAR, '1')
    expect(assertCampusMutationAllowed('map-map-1-k6bv')).toBeNull()
  })

  it('override: any value other than "1" still refuses', () => {
    for (const value of ['true', '0', 'yes', '']) {
      vi.stubEnv(PROTECTED_CAMPUS_WRITE_OVERRIDE_VAR, value)
      expect(assertCampusMutationAllowed('map-map-1-k6bv')?.status).toBe(423)
    }
  })
})

describe('getCampusIdFromBody', () => {
  it('reads campusId and campus_id at the top level', () => {
    expect(getCampusIdFromBody({ campusId: 'campus-a' })).toBe('campus-a')
    expect(getCampusIdFromBody({ campus_id: 'campus-b' })).toBe('campus-b')
  })

  it('reads campusId/campus_id nested under payload', () => {
    expect(getCampusIdFromBody({ payload: { campusId: 'campus-c' } })).toBe('campus-c')
    expect(getCampusIdFromBody({ payload: { campus_id: 'campus-d' } })).toBe('campus-d')
  })

  it('returns null for unrelated/empty shapes', () => {
    expect(getCampusIdFromBody({})).toBeNull()
    expect(getCampusIdFromBody(null)).toBeNull()
    expect(getCampusIdFromBody('campus-a')).toBeNull()
    expect(getCampusIdFromBody({ campusId: '   ' })).toBeNull()
  })
})
