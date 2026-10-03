// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as campusesPOST, DELETE as campusesDELETE } from '@/app/api/campuses/route'
import { POST as buildingsPOST, DELETE as buildingsDELETE } from '@/app/api/buildings/route'
import { POST as campusMapsPOST, DELETE as campusMapsDELETE } from '@/app/api/campus-maps/route'
import { POST as publishPOST } from '@/app/api/publish/route'
import { POST as floorPlansPOST } from '@/app/api/floor-plans/route'
import { POST as compilePOST } from '@/app/api/compile/route'
import { POST as r2ConnectivityPOST } from '@/app/api/r2-connectivity-test/route'
import { POST as panoramaUploadPOST } from '@/app/api/panorama-upload/route'

const req = (url: string, method: string, init: RequestInit = {}) =>
  new NextRequest(url, { method, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, ...init })

const FAKE_SESSION = { cookie: 'sb-abcdefgh-auth-token=forged-value' }

describe('privileged mutation routes — verified-auth wiring (Phase 7/8)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('missing session => 401 on every migrated privileged mutation route, with zero upstream network calls', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const cases: Array<[string, () => Promise<Response>]> = [
      ['campuses POST', () => campusesPOST(req('http://x/api/campuses', 'POST', { body: JSON.stringify({}) }))],
      ['campuses DELETE', () => campusesDELETE(req('http://x/api/campuses?campus_id=dev-x', 'DELETE'))],
      ['buildings POST', () => buildingsPOST(req('http://x/api/buildings', 'POST', { body: JSON.stringify({}) }))],
      ['buildings DELETE', () => buildingsDELETE(req('http://x/api/buildings?campus_id=dev-x', 'DELETE'))],
      ['campus-maps POST', () => campusMapsPOST(req('http://x/api/campus-maps', 'POST', { body: JSON.stringify({}) }))],
      ['campus-maps DELETE', () => campusMapsDELETE(req('http://x/api/campus-maps?map_id=dev-x', 'DELETE'))],
      ['publish POST', () => publishPOST(req('http://x/api/publish', 'POST', { body: JSON.stringify({}) }))],
      ['floor-plans POST', () => floorPlansPOST(req('http://x/api/floor-plans', 'POST'))],
      ['compile POST', () => compilePOST(req('http://x/api/compile', 'POST', { body: JSON.stringify({}) }))],
      ['r2-connectivity-test POST', () => r2ConnectivityPOST(req('http://x/api/r2-connectivity-test', 'POST'))],
      // panorama-upload signs real URLs — the auth gate must precede any signing.
      ['panorama-upload POST', () => panoramaUploadPOST(req('http://x/api/panorama-upload', 'POST', { body: JSON.stringify({}) }))],
    ]
    for (const [name, call] of cases) {
      const res = await call()
      expect(res.status, `${name} must 401 without a session`).toBe(401)
      const body = await res.json()
      expect(JSON.stringify(body)).not.toMatch(/supabase|service|apikey|secret/i)
    }
    expect(fetchSpy).not.toHaveBeenCalled() // auth failure => no privileged work / no network
  })

  it('fake cookie in a production runtime => 401 (fail closed; presence is not authentication)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    const fetchSpy = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', fetchSpy)
    for (const call of [
      () => campusesPOST(req('http://x/api/campuses', 'POST', { headers: FAKE_SESSION, body: JSON.stringify({}) })),
      () => buildingsDELETE(req('http://x/api/buildings?campus_id=dev-x', 'DELETE', { headers: FAKE_SESSION })),
      () => publishPOST(req('http://x/api/publish', 'POST', { headers: FAKE_SESSION, body: JSON.stringify({}) })),
      () => floorPlansPOST(req('http://x/api/floor-plans', 'POST', { headers: FAKE_SESSION })),
      () => compilePOST(req('http://x/api/compile', 'POST', { headers: FAKE_SESSION, body: JSON.stringify({}) })),
    ]) {
      const res = await call()
      expect(res.status).toBe(401)
    }
  })

  it('protected campus remains 423 for authenticated admin path (guard preserved, not weakened)', async () => {
    const { assertCampusMutationAllowed } = await import('@/lib/api-guard')
    expect(assertCampusMutationAllowed('map-map-1-k6bv')?.status).toBe(423)
  })
})
