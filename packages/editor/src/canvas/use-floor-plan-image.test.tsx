import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFloorPlanImage } from './use-floor-plan-image'

describe('useFloorPlanImage', () => {
  it('returns null image when url is null', () => {
    const { result } = renderHook(() => useFloorPlanImage(null))
    expect(result.current.image).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('returns null image when url is undefined', () => {
    const { result } = renderHook(() => useFloorPlanImage(undefined))
    expect(result.current.image).toBeNull()
  })

  it('returns null image when url is empty string', () => {
    const { result } = renderHook(() => useFloorPlanImage(''))
    expect(result.current.image).toBeNull()
  })
})
