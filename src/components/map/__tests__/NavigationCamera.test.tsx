import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NavigationCamera from '../NavigationCamera'

const cameraFixture = vi.hoisted(() => {
  const controller = {
    update: vi.fn(),
    recenter: vi.fn(),
    resetCompass: vi.fn(),
    setHeadingFollowEnabled: vi.fn(),
    fitRoute: vi.fn(),
    getState: vi.fn(() => ({
      mode: 'FOLLOW',
      topOrientation: 'free',
      followSuspended: false,
      headingFollowSuspended: false,
      bearing: 90,
    })),
    destroy: vi.fn(),
  }
  return {
    map: { id: 'map' },
    isReady: true,
    controller,
    create: vi.fn(() => controller),
  }
})

vi.mock('@/components/map/NavigationMap', () => ({
  useNavigationMap: () => ({ map: cameraFixture.map, isReady: cameraFixture.isReady }),
}))

vi.mock('@/lib/navigation-camera-controller', () => ({
  createNavigationCameraController: cameraFixture.create,
}))

describe('NavigationCamera React bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cameraFixture.isReady = true
  })

  it('creates the imperative controller only when the map is ready and forwards presentation inputs', async () => {
    const onToggleHeadingFollow = vi.fn()
    render(
      <NavigationCamera
        surface="active"
        mode="FOLLOW"
        initialSetup
        position={[122.1, 11.8]}
        heading={90}
        headingFollowEnabled
        onToggleHeadingFollow={onToggleHeadingFollow}
        routeBounds={{ minLng: 122.1, maxLng: 122.11, minLat: 11.8, maxLat: 11.81 }}
        showControls
      />,
    )

    await waitFor(() => expect(cameraFixture.create).toHaveBeenCalledTimes(1))
    expect(cameraFixture.create).toHaveBeenCalledWith(
      cameraFixture.map,
      expect.objectContaining({ reducedMotion: false }),
    )
    expect(cameraFixture.controller.update).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
        headingFollowEnabled: true,
      initialSetup: true,
    }))
    expect(screen.getByTestId('navigation-camera-controls')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Turn heading follow off' }))
    expect(cameraFixture.controller.setHeadingFollowEnabled).toHaveBeenCalledWith(false, 90)
    expect(onToggleHeadingFollow).toHaveBeenCalledWith(false)
  })

  it('keeps the parent-selected camera mode authoritative across rerenders', async () => {
    const { rerender } = render(
      <NavigationCamera
        surface="active"
        mode="TOP"
        position={[122.1, 11.8]}
        heading={90}
        headingFollowEnabled={false}
        showControls={false}
      />,
    )

    await waitFor(() => expect(cameraFixture.controller.update).toHaveBeenCalled())

    rerender(
      <NavigationCamera
        surface="active"
        mode="FOLLOW"
        position={[122.1, 11.8]}
        heading={90}
        headingFollowEnabled={false}
        showControls={false}
      />,
    )
    rerender(
      <NavigationCamera
        surface="active"
        mode="POV"
        position={[122.1, 11.8]}
        heading={90}
        headingFollowEnabled={false}
        showControls={false}
      />,
    )

    expect(cameraFixture.controller.update).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'POV' }))
  })

  it('keeps route preview Top-only and wires Recenter, Compass, and permission actions', async () => {
    const onModeChange = vi.fn()
    const onRequestHeadingPermission = vi.fn()

    render(
      <NavigationCamera
        surface="route-preview"
        mode="POV"
        position={null}
        heading={null}
        canRequestHeadingPermission
        headingStatus="permission-required"
        onModeChange={onModeChange}
        onRequestHeadingPermission={onRequestHeadingPermission}
        showControls
      />,
    )

    await waitFor(() => expect(cameraFixture.controller.update).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'route-preview',
      mode: 'TOP',
    })))
    fireEvent.click(screen.getByRole('button', { name: /^Camera view: Top\./ }))
    expect(screen.queryByRole('button', { name: 'Follow view' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'POV view' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Enable compass' }))
    expect(onRequestHeadingPermission).toHaveBeenCalledTimes(1)
  })

  it('starts the existing heading permission flow from Heading Follow enable', async () => {
    const onToggleHeadingFollow = vi.fn()
    const onRequestHeadingPermission = vi.fn()

    render(
      <NavigationCamera
        surface="active"
        mode="FOLLOW"
        headingStatus="permission-required"
        canRequestHeadingPermission
        onToggleHeadingFollow={onToggleHeadingFollow}
        onRequestHeadingPermission={onRequestHeadingPermission}
        showControls
      />,
    )

    await waitFor(() => expect(cameraFixture.controller.update).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Turn heading follow on' }))

    expect(onRequestHeadingPermission).toHaveBeenCalledTimes(1)
    expect(cameraFixture.controller.setHeadingFollowEnabled).toHaveBeenCalledWith(true, null)
    expect(onToggleHeadingFollow).toHaveBeenCalledWith(true)
  })

  it('does not create a controller or render controls before map readiness', () => {
    cameraFixture.isReady = false
    render(<NavigationCamera surface="active" mode="FOLLOW" showControls />)

    expect(cameraFixture.create).not.toHaveBeenCalled()
    expect(screen.queryByTestId('navigation-camera-controls')).toBeNull()
    cameraFixture.isReady = true
  })
})
