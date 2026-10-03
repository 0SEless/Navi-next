import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNavigationDevSimulation } from '../useNavigationDevSimulation'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('useNavigationDevSimulation', () => {
  it('keeps simulation state unavailable unless explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_NAVI_DEV_LOCATION', '1')
    const { result } = renderHook(() => useNavigationDevSimulation())

    expect(result.current.enabled).toBe(false)
    expect(result.current.simulation).toBeNull()
  })

  it('updates heading and position through the simulation adapter', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_NAVI_DEV_LOCATION', '1')
    const { result } = renderHook(() => useNavigationDevSimulation())

    expect(result.current.enabled).toBe(true)
    expect(result.current.simulation?.position).toEqual({ lat: 11.81830075, lng: 122.17159818 })

    act(() => result.current.setHeading(359))
    expect(result.current.simulation?.heading).toBe(359)

    const before = result.current.simulation?.position
    act(() => result.current.nudge('east'))
    expect(result.current.simulation?.position.lng).toBeGreaterThan(before?.lng ?? 0)
  })
})
