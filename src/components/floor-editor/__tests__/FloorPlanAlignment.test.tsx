import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import maplibregl from 'maplibre-gl'
import { FloorPlanAlignment } from '../FloorPlanAlignment'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makeMap() {
  const source = {
    setCoordinates: vi.fn(),
    updateImage: vi.fn(),
  }
  const dragPan = {
    isEnabled: vi.fn(() => true),
    disable: vi.fn(),
    enable: vi.fn(),
  }
  const map = {
    project: vi.fn((coordinate: [number, number]) => ({ x: coordinate[0], y: coordinate[1] })),
    unproject: vi.fn(([x, y]: [number, number]) => ({ lng: 121 + x / 100000, lat: 14 + y / 100000 })),
    on: vi.fn(),
    off: vi.fn(),
    getSource: vi.fn(() => source),
    dragPan,
    getContainer: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
    getCanvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
  } as unknown as maplibregl.Map
  return { map, source, dragPan }
}

function addPointerCapture(target: HTMLElement) {
  Object.defineProperty(target, 'setPointerCapture', { value: vi.fn(), configurable: true })
  Object.defineProperty(target, 'releasePointerCapture', { value: vi.fn(), configurable: true })
}

const footprint = [
  { lat: 14.0004, lng: 120.9995 },
  { lat: 14.0004, lng: 121.0005 },
  { lat: 13.9996, lng: 121.0005 },
  { lat: 13.9996, lng: 120.9995 },
]

const coords = [[10, 40], [110, 40], [110, -40], [10, -40]] as [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
]

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

describe('FloorPlanAlignment', () => {
  it('positions each corner handle at its projected plan corner', async () => {
    const { map } = makeMap()

    render(
      <FloorPlanAlignment
        map={map}
        floorPlanCoords={coords}
        buildingFp={footprint}
        alignment={{ scale: 1 }}
        onChange={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('floor-plan-handle-nw')).toBeInTheDocument())
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => screen.getByTestId(`floor-plan-handle-${handle}`))

    expect(handles.map((handle) => ({ left: handle.style.left, top: handle.style.top }))).toEqual([
      { left: '10px', top: '40px' },
      { left: '60px', top: '40px' },
      { left: '110px', top: '40px' },
      { left: '110px', top: '0px' },
      { left: '110px', top: '-40px' },
      { left: '60px', top: '-40px' },
      { left: '10px', top: '-40px' },
      { left: '10px', top: '0px' },
    ])
  })

  it('renders eight semantic resize handles, rotation, body, and a session aspect lock', async () => {
    const { map } = makeMap()
    render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 1, scaleY: 1 }} onChange={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('floor-plan-handle-nw')).toBeInTheDocument())
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(screen.getByTestId(`floor-plan-handle-${handle}`)).toHaveAttribute('aria-label')
    }
    expect(screen.getByTestId('floor-plan-rotation-handle')).toHaveAttribute('aria-label', 'Rotate floor plan')
    expect(screen.getByTestId('floor-plan-body')).toBeInTheDocument()
    expect(screen.getByTestId('floor-plan-aspect-lock')).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses the parent-owned aspect lock state when provided', async () => {
    const onAspectRatioLockedChange = vi.fn()
    const { map } = makeMap()
    render(
      <FloorPlanAlignment
        map={map}
        floorPlanCoords={coords}
        buildingFp={footprint}
        alignment={{ scaleX: 1, scaleY: 1 }}
        aspectRatioLocked={false}
        onAspectRatioLockedChange={onAspectRatioLockedChange}
        onChange={vi.fn()}
      />,
    )

    const toggle = await screen.findByTestId('floor-plan-aspect-lock')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(onAspectRatioLockedChange).toHaveBeenCalledWith(true)
  })

  it('scales both canonical axes proportionally from keyboard shortcuts', async () => {
    const { map } = makeMap()
    const onChange = vi.fn()
    render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 2, scaleY: 0.5 }} onChange={onChange} />)

    await screen.findByTestId('floor-plan-body')
    fireEvent.keyDown(window, { key: '+', target: document.body })
    const next = onChange.mock.calls[0][0]
    expect(next.scaleX).toBeGreaterThan(2)
    expect(next.scaleY).toBeGreaterThan(0.5)
    expect(next.scaleX / next.scaleY).toBeCloseTo(4, 8)
  })

  it('previews pointer movement without committing and commits exactly once on pointerup', async () => {
    const { map, source, dragPan } = makeMap()
    const onChange = vi.fn()
    render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 1, scaleY: 1, rotation: 12 }} floorPlanUrl="plan.png" onChange={onChange} />)

    const body = await screen.findByTestId('floor-plan-body')
    addPointerCapture(body)
    fireEvent.pointerDown(body, { pointerId: 7, clientX: 40, clientY: 20, buttons: 1 })
    expect(dragPan.disable).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(body, { pointerId: 7, clientX: 60, clientY: 35, buttons: 1 })

    expect(onChange).not.toHaveBeenCalled()
    expect(source.setCoordinates).toHaveBeenCalled()
    expect(source.updateImage).not.toHaveBeenCalled()

    fireEvent.pointerUp(body, { pointerId: 7, clientX: 60, clientY: 35 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].scaleX).toBe(1)
    expect(onChange.mock.calls[0][0].scaleY).toBe(1)
    expect(onChange.mock.calls[0][0].rotation).toBe(12)
    expect(dragPan.enable).toHaveBeenCalledTimes(1)
  })

  it('coalesces pointermove work into one animation-frame preview', async () => {
    let queuedFrame: FrameRequestCallback | undefined
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      queuedFrame = callback
      return 42
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)

    const { map, source } = makeMap()
    const onChange = vi.fn()
    render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 1, scaleY: 1 }} onChange={onChange} />)
    const body = await screen.findByTestId('floor-plan-body')
    addPointerCapture(body)

    fireEvent.pointerDown(body, { pointerId: 11, clientX: 40, clientY: 20 })
    expect((body.setPointerCapture as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(11)
    fireEvent.pointerMove(body, { pointerId: 11, clientX: 50, clientY: 25 })
    fireEvent.pointerMove(body, { pointerId: 11, clientX: 60, clientY: 35 })

    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(source.setCoordinates).not.toHaveBeenCalled()
    queuedFrame?.(0)
    expect(source.setCoordinates).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(body, { pointerId: 11, clientX: 60, clientY: 35 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((body.releasePointerCapture as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(11)
  })

  it('uses the semantic edge handle and rotation handle from the gesture-start transform', async () => {
    const { map, source } = makeMap()
    const onChange = vi.fn()
    render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 1, scaleY: 1, rotation: 0 }} onChange={onChange} />)

    const east = await screen.findByTestId('floor-plan-handle-e')
    addPointerCapture(east)
    fireEvent.pointerDown(east, { pointerId: 12, clientX: 110, clientY: 0 })
    fireEvent.pointerMove(east, { pointerId: 12, clientX: 140, clientY: 0 })
    fireEvent.pointerUp(east, { pointerId: 12, clientX: 140, clientY: 0 })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].scaleX).toBeGreaterThan(1)
    expect(onChange.mock.calls[0][0].scaleY).toBe(1)
    expect(source.updateImage).not.toHaveBeenCalled()

    onChange.mockClear()
    const rotation = await screen.findByTestId('floor-plan-rotation-handle')
    addPointerCapture(rotation)
    fireEvent.pointerDown(rotation, { pointerId: 13, clientX: 60, clientY: -30 })
    fireEvent.pointerMove(rotation, { pointerId: 13, clientX: 90, clientY: -10 })
    fireEvent.pointerUp(rotation, { pointerId: 13, clientX: 90, clientY: -10 })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].rotation).not.toBe(0)
    expect(onChange.mock.calls[0][0].scaleX).toBeGreaterThan(1)
    expect(onChange.mock.calls[0][0].scaleY).toBe(1)
    expect(source.updateImage).not.toHaveBeenCalled()
  })

  it('cancels on Escape and pointercancel without committing or leaking map drag state', async () => {
    const { map, dragPan } = makeMap()
    const onChange = vi.fn()
    const { unmount } = render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 1, scaleY: 1 }} onChange={onChange} />)
    const body = await screen.findByTestId('floor-plan-body')
    addPointerCapture(body)

    fireEvent.pointerDown(body, { pointerId: 8, clientX: 20, clientY: 20, buttons: 1 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(dragPan.enable).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(body, { pointerId: 9, clientX: 20, clientY: 20, buttons: 1 })
    fireEvent.pointerCancel(body, { pointerId: 9 })
    expect(onChange).not.toHaveBeenCalled()
    expect(dragPan.enable).toHaveBeenCalledTimes(2)

    fireEvent.pointerDown(body, { pointerId: 10, clientX: 20, clientY: 20, buttons: 1 })
    unmount()
    expect(dragPan.enable).toHaveBeenCalledTimes(3)
  })

  it('cancels through lost pointer capture and validation failure', async () => {
    const { map, dragPan } = makeMap()
    const onChange = vi.fn()
    render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 1, scaleY: 1 }} onChange={onChange} />)
    const body = await screen.findByTestId('floor-plan-body')
    addPointerCapture(body)

    fireEvent.pointerDown(body, { pointerId: 14, clientX: 20, clientY: 20 })
    fireEvent.lostPointerCapture(body, { pointerId: 14 })
    expect(onChange).not.toHaveBeenCalled()
    expect(dragPan.enable).toHaveBeenCalledTimes(1)

    const unproject = vi.mocked(map.unproject)
    unproject.mockReturnValue({ lng: Number.NaN, lat: 14 } as maplibregl.LngLat)
    fireEvent.pointerDown(body, { pointerId: 15, clientX: 20, clientY: 20 })
    expect(dragPan.enable).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('changes the session aspect-lock state without persisting it', async () => {
    const { map } = makeMap()
    const onChange = vi.fn()
    render(<FloorPlanAlignment map={map} floorPlanCoords={coords} buildingFp={footprint} alignment={{ scaleX: 1.4, scaleY: 0.7 }} onChange={onChange} />)
    const lock = await screen.findByTestId('floor-plan-aspect-lock')
    fireEvent.click(lock)
    expect(lock).toHaveAttribute('aria-pressed', 'false')
    expect(onChange).not.toHaveBeenCalled()
  })
})
