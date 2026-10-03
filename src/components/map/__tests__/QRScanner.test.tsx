import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QRScanner } from '../QRScanner'

const scannerHarness = vi.hoisted(() => {
  const state: {
    onDecode: ((text: string) => void) | null
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  } = {
    onDecode: null,
    start: vi.fn(),
    stop: vi.fn(),
  }
  state.start.mockImplementation(async (
    _camera: unknown,
    _config: unknown,
    onDecode: (text: string) => void,
  ) => {
    state.onDecode = onDecode
  })
  state.stop.mockResolvedValue(undefined)
  class MockHtml5Qrcode {
    start(...args: unknown[]) {
      return state.start(...args)
    }

    stop() {
      return state.stop()
    }
  }
  return Object.assign(state, { MockHtml5Qrcode })
})

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: scannerHarness.MockHtml5Qrcode,
}))

afterEach(cleanup)

beforeEach(() => {
  scannerHarness.onDecode = null
  scannerHarness.start.mockClear()
  scannerHarness.stop.mockClear()
})

describe('QRScanner', () => {
  it('forwards the raw payload to the shared resolver when requested', async () => {
    const onPayload = vi.fn()
    const onScan = vi.fn()
    render(<QRScanner onScan={onScan} onPayload={onPayload} />)

    await waitFor(() => expect(scannerHarness.onDecode).not.toBeNull())
    act(() => scannerHarness.onDecode?.('navi.app/q/checkpoint-1'))

    expect(onPayload).toHaveBeenCalledWith('navi.app/q/checkpoint-1')
    expect(onScan).not.toHaveBeenCalled()
    expect(scannerHarness.stop).toHaveBeenCalledTimes(1)
  })

  it('preserves the legacy node callback when no raw resolver is supplied', async () => {
    const onScan = vi.fn()
    render(<QRScanner onScan={onScan} />)

    await waitFor(() => expect(scannerHarness.onDecode).not.toBeNull())
    act(() => scannerHarness.onDecode?.('https://navi.app/map/navigate?node=legacy-node'))

    expect(onScan).toHaveBeenCalledWith('legacy-node')
  })
})
