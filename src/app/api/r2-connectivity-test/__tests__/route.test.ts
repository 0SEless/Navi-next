// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/r2-connectivity-test/route'

const { sendMock, commandInputs } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  commandInputs: [] as Array<Record<string, unknown>>,
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock
  },
  PutObjectCommand: class {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
      commandInputs.push(input)
    }
  },
}))

const SESSION = { cookie: 'sb-abcdefgh-auth-token=trusted-session' }

const req = (headers: Record<string, string> = {}) =>
  new NextRequest('http://x/api/r2-connectivity-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const FULL_CONFIG_ENV = {
  R2_ENDPOINT: 'https://sentinel-endpoint.example',
  R2_BUCKET: 'navi-360',
  R2_ACCESS_KEY_ID: 'sentinel-access-key-id',
  R2_SECRET_ACCESS_KEY: 'sentinel-secret-access-key',
  R2_REGION: 'auto',
}

describe('POST /api/r2-connectivity-test (R2 connectivity)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    sendMock.mockReset()
    commandInputs.length = 0
  })

  it('401 without a session, and never reaches R2 or the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    sendMock.mockResolvedValue({})
    for (const [key, value] of Object.entries(FULL_CONFIG_ENV)) vi.stubEnv(key, value)

    const res = await POST(req())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(JSON.stringify(body)).toMatch(/authentication required/i)
    expect(sendMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(commandInputs).toHaveLength(0)
  })

  it('sanitized 500 when configuration is missing: names only, no values', async () => {
    sendMock.mockResolvedValue({})
    vi.stubEnv('R2_ENDPOINT', 'https://sentinel-endpoint.example')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'sentinel-access-key-id')
    vi.stubEnv('R2_REGION', 'auto')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', '')

    const res = await POST(req(SESSION))

    expect(res.status).toBe(500)
    const text = JSON.stringify(await res.json())
    expect(text).toContain('missing_configuration')
    expect(text).toContain('R2_SECRET_ACCESS_KEY')
    expect(text).toContain('R2_BUCKET')
    // No environment value may ever appear in the response.
    expect(text).not.toContain('sentinel-endpoint.example')
    expect(text).not.toContain('sentinel-access-key-id')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('uploads the exact test object and returns the exact success payload', async () => {
    sendMock.mockResolvedValue({})
    for (const [key, value] of Object.entries(FULL_CONFIG_ENV)) vi.stubEnv(key, value)

    const res = await POST(req(SESSION))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      provider: 'cloudflare-r2',
      bucket: 'navi-360',
      object: '_navi-tests/r2-connectivity-test.txt',
    })

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(commandInputs).toHaveLength(1)
    expect(commandInputs[0]).toMatchObject({
      Bucket: 'navi-360',
      Key: '_navi-tests/r2-connectivity-test.txt',
      Body: 'NAVI R2 connectivity test',
    })
    // Private bucket: no ACL, no presign-style public exposure.
    expect(commandInputs[0]).not.toHaveProperty('ACL')
  })

  it('returns a sanitized 502 when R2 rejects the request', async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error('sentinel-error-message-must-not-leak'), {
        name: 'SignatureDoesNotMatch',
        $metadata: { httpStatusCode: 403, requestId: 'req-123' },
      }),
    )
    for (const [key, value] of Object.entries(FULL_CONFIG_ENV)) vi.stubEnv(key, value)

    const res = await POST(req(SESSION))

    expect(res.status).toBe(502)
    const text = JSON.stringify(await res.json())
    expect(text).toContain('r2_request_failed')
    expect(text).toContain('SignatureDoesNotMatch')
    expect(text).toContain('req-123')
    // Nothing sensitive: no message body, endpoint, or credentials.
    expect(text).not.toContain('sentinel-error-message-must-not-leak')
    expect(text).not.toContain('sentinel-endpoint.example')
    expect(text).not.toContain('sentinel-access-key-id')
    expect(text).not.toContain('sentinel-secret-access-key')
  })
})
