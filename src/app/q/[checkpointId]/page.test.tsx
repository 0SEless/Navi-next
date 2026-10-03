import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => navigation)

import QrCheckpointRedirectPage from './page'

beforeEach(() => {
  navigation.redirect.mockClear()
  navigation.notFound.mockClear()
})

describe('/q/[checkpointId]', () => {
  it('redirects a valid checkpoint to the canonical Navigate deep link', async () => {
    await QrCheckpointRedirectPage({ params: Promise.resolve({ checkpointId: 'campus-b-checkpoint' }) })

    expect(navigation.redirect).toHaveBeenCalledWith('/map/navigate?qr=campus-b-checkpoint')
    expect(navigation.notFound).not.toHaveBeenCalled()
  })

  it('does not redirect malformed checkpoint ids', async () => {
    await QrCheckpointRedirectPage({ params: Promise.resolve({ checkpointId: 'javascript:alert(1)' }) })

    expect(navigation.notFound).toHaveBeenCalledTimes(1)
    expect(navigation.redirect).not.toHaveBeenCalled()
  })
})
