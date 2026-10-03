import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ConfirmOverlay } from '../ConfirmOverlay'

const mocks = vi.hoisted(() => {
  const state = {
    pendingConfirm: {
      type: 'import-osm',
      points: [
        { lat: 1, lng: 2 },
        { lat: 1, lng: 3 },
        { lat: 2, lng: 3 },
      ],
    },
    clearPendingConfirm: vi.fn(() => { state.pendingConfirm = null }),
    setActiveBuilding: vi.fn(),
    clearTracePoints: vi.fn(),
    activeFloor: 0,
    routeWidth: 8,
    setRouteWidth: vi.fn(),
    clearDrawPoints: vi.fn(),
  }
  return {
    state,
    dispatcher: { execute: vi.fn(() => ({ success: true })) },
    workflow: { save: vi.fn(async () => undefined) },
    editEngine: { begin: vi.fn(), doCommit: vi.fn(() => ({ committed: true })) },
    showImportToast: vi.fn(),
  }
})

const BUILDING_POINTS = [
  { lat: 1, lng: 2 },
  { lat: 1, lng: 3 },
  { lat: 2, lng: 3 },
]

function setBuildingConfirmation() {
  mocks.state.pendingConfirm = { type: 'building', points: BUILDING_POINTS }
}

vi.mock('@/store/studio-store', () => ({
  useStudioStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}))

vi.mock('@navi/editor', () => ({
  useEditor: () => ({
    services: {
      get: (id: string) => id === 'dispatcher' ? mocks.dispatcher : mocks.workflow,
    },
  }),
  useEditingEngine: () => mocks.editEngine,
  genId: (prefix: string) => `${prefix}-test`,
}))

vi.mock('../ImportToast', () => ({
  showImportToast: mocks.showImportToast,
}))

describe('ConfirmOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.pendingConfirm = {
      type: 'import-osm',
      points: [
        { lat: 1, lng: 2 },
        { lat: 1, lng: 3 },
        { lat: 2, lng: 3 },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        buildings: [{
          id: 'osm-1',
          name: 'Imported Hall',
          footprint: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2.1 }, { lat: 1.1, lng: 2.1 }],
          height: 12,
          color: '#1C6BEB',
        }],
      }),
    })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('imports and persists buildings only after Save', async () => {
    render(<ConfirmOverlay />)
    const boundary = [...mocks.state.pendingConfirm.points]
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.workflow.save).toHaveBeenCalledWith('manual'))
    expect(fetch).toHaveBeenCalledWith('/api/osm-buildings', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ boundary }),
    }))
    expect(mocks.dispatcher.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'building.create',
      payload: expect.objectContaining({ name: 'Imported Hall' }),
    }))
    expect(mocks.state.clearDrawPoints).toHaveBeenCalledTimes(1)
    expect(mocks.state.clearPendingConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.showImportToast).toHaveBeenCalledWith({ message: 'Imported 1 buildings from OSM', type: 'success' })
  })

  it('saves a route with the selected navigation-only display mode', async () => {
    mocks.state.pendingConfirm = {
      type: 'route',
      points: [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }],
    } as typeof mocks.state.pendingConfirm
    render(<ConfirmOverlay />)

    fireEvent.click(screen.getByRole('button', { name: 'Navigation-only route' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.workflow.save).toHaveBeenCalledWith('manual'))
    expect(mocks.dispatcher.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'road.create',
      payload: expect.objectContaining({ displayMode: 'navigation-only' }),
    }))
  })

  it('creates one building and finalizes the confirmation after Save succeeds', async () => {
    setBuildingConfirmation()
    render(<ConfirmOverlay />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.workflow.save).toHaveBeenCalledWith('manual'))
    expect(mocks.dispatcher.execute).toHaveBeenCalledTimes(1)
    expect(mocks.dispatcher.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'building.create',
      payload: expect.objectContaining({ id: 'bldg-test', footprint: { points: BUILDING_POINTS } }),
    }))
    expect(mocks.state.clearDrawPoints).toHaveBeenCalledTimes(1)
    expect(mocks.state.clearPendingConfirm).toHaveBeenCalledTimes(1)
  })

  it('ignores a rapid second Save while the first persistence is pending', async () => {
    setBuildingConfirmation()
    let resolveSave!: () => void
    mocks.workflow.save.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    render(<ConfirmOverlay />)

    const save = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(save)
    fireEvent.click(save)

    expect(mocks.dispatcher.execute).toHaveBeenCalledTimes(1)
    expect(save).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()

    resolveSave()
    await waitFor(() => expect(mocks.state.clearPendingConfirm).toHaveBeenCalledTimes(1))
  })

  it('keeps the draft and reuses the committed building when persistence fails', async () => {
    setBuildingConfirmation()
    mocks.workflow.save
      .mockRejectedValueOnce(new Error('sync unavailable'))
      .mockResolvedValueOnce(undefined)
    render(<ConfirmOverlay />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('sync unavailable'))
    expect(mocks.dispatcher.execute).toHaveBeenCalledTimes(1)
    expect(mocks.state.clearPendingConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.state.clearPendingConfirm).toHaveBeenCalledTimes(1))
    expect(mocks.dispatcher.execute).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft when the building command is rejected and allows retry', async () => {
    setBuildingConfirmation()
    mocks.dispatcher.execute
      .mockReturnValueOnce({ success: false, error: 'invalid footprint' })
      .mockReturnValue({ success: true })
    render(<ConfirmOverlay />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('invalid footprint'))
    expect(mocks.state.clearPendingConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.state.clearPendingConfirm).toHaveBeenCalledTimes(1))
    expect(mocks.dispatcher.execute).toHaveBeenCalledTimes(2)
  })

  it('keeps Cancel destructive only to the draft and does not create a building', () => {
    setBuildingConfirmation()
    render(<ConfirmOverlay />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.dispatcher.execute).not.toHaveBeenCalled()
    expect(mocks.state.clearDrawPoints).toHaveBeenCalledTimes(1)
    expect(mocks.state.clearPendingConfirm).toHaveBeenCalledTimes(1)
  })

  it('allows a second intentional building after the first confirmation finalizes', async () => {
    setBuildingConfirmation()
    const first = render(<ConfirmOverlay />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.state.clearPendingConfirm).toHaveBeenCalledTimes(1))
    first.unmount()

    setBuildingConfirmation()
    render(<ConfirmOverlay />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.workflow.save).toHaveBeenCalledTimes(2))
    expect(mocks.dispatcher.execute).toHaveBeenCalledTimes(2)
  })
})
