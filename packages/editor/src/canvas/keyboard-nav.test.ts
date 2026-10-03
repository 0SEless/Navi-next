import { describe, it, expect } from 'vitest'
import { handleKeyboard, type KeyboardResult } from './keyboard-nav'
import { createCamera, type CameraState } from './viewport'

describe('handleKeyboard', () => {
  const camera = createCamera()

  it('pans left on ArrowLeft', () => {
    const result = handleKeyboard('ArrowLeft', camera)
    expect(result).not.toBeNull()
    expect(result!.center!.x).toBeCloseTo(-1)
    expect(result!.center!.y).toBeCloseTo(0)
  })

  it('pans right on ArrowRight', () => {
    const result = handleKeyboard('ArrowRight', camera)
    expect(result!.center!.x).toBeCloseTo(1)
  })

  it('pans up on ArrowUp (positive Y in building-local)', () => {
    const result = handleKeyboard('ArrowUp', camera)
    expect(result!.center!.y).toBeCloseTo(1)
  })

  it('pans down on ArrowDown', () => {
    const result = handleKeyboard('ArrowDown', camera)
    expect(result!.center!.y).toBeCloseTo(-1)
  })

  it('zooms in on +', () => {
    const result = handleKeyboard('+', camera)
    expect(result).not.toBeNull()
    expect(result!.zoom).toBeCloseTo(1.2)
  })

  it('zooms out on -', () => {
    const result = handleKeyboard('-', camera)
    expect(result).not.toBeNull()
    expect(result!.zoom).toBeCloseTo(1 / 1.2)
  })

  it('returns null for unhandled keys', () => {
    expect(handleKeyboard('a', camera)).toBeNull()
    expect(handleKeyboard('Enter', camera)).toBeNull()
  })

  it('respects zoom limits', () => {
    const maxCam = createCamera({ zoom: 50 })
    const result = handleKeyboard('+', maxCam)
    expect(result!.zoom).toBe(50) // clamped
  })

  it('respects min zoom', () => {
    const minCam = createCamera({ zoom: 0.1 })
    const result = handleKeyboard('-', minCam)
    expect(result!.zoom).toBe(0.1) // clamped
  })

  it('handles Shift+Arrow for larger pan steps', () => {
    const result = handleKeyboard('ArrowRight', camera, { shift: true })
    expect(result!.center!.x).toBeCloseTo(5)
  })
})
