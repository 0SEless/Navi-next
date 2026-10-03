import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CampusBundle, NavNode } from '@/types/nav-types'
import type { NavRoute, RouteProgress } from '@/types/route-types'
import type { QrNavigateDeepLinkState } from '@/hooks/useQrNavigateDeepLink'
import { usePublicStore } from '@/store/public-store'
import NavigatePage from './page'

const navigationMock = vi.hoisted(() => ({
  arrived: false,
  isOffRoute: false,
  progressIndex: 0,
  sessionPoiId: null as string | null,
  camera: null as {
    surface?: string
    mode?: string
    topOrientation?: string
    routeBounds?: unknown
    headingFollowEnabled?: boolean
    onModeChange?: (mode: string) => void
    onToggleHeadingFollow?: (enabled: boolean) => void
  } | null,
}))

const qrNavigationMock = vi.hoisted(() => ({
  state: {} as QrNavigateDeepLinkState,
}))

vi.mock('next/dynamic', () => ({
  default: () => function ExploreMapStub({ camera }: { camera?: typeof navigationMock.camera }) {
    navigationMock.camera = camera ?? null
    return (
      <div
        data-testid="navigate-map-stub"
        data-camera-surface={camera?.surface ?? ''}
        data-camera-mode={camera?.mode ?? ''}
        data-camera-top-orientation={camera?.topOrientation ?? ''}
        data-camera-has-bounds={String(Boolean(camera?.routeBounds))}
        data-camera-heading-follow={String(Boolean(camera?.headingFollowEnabled))}
      />
    )
  },
}))

vi.mock('@/components/map/NavigationSession', async () => {
  const { NavigationProvider } = await import('@/components/map/NavigationContext')

  return {
    NavigationSession: ({
      children,
      active = false,
      route = null,
      poiDestination = null,
    }: {
      children: ReactNode
      active?: boolean
      route?: NavRoute | null
      poiDestination?: { id: string } | null
    }) => {
      navigationMock.sessionPoiId = poiDestination?.id ?? null
      const firstStep = route?.steps[0]
      const activeStep = route?.steps[Math.min(navigationMock.progressIndex, Math.max((route?.steps.length ?? 1) - 1, 0))]
      const routeProgress: RouteProgress | null = active && firstStep
        ? {
            index: navigationMock.progressIndex,
            remainingDistance: activeStep?.nodeId === route.arrival.nodeId ? 0 : route.totalDistance,
            currentSegment: activeStep?.type === 'entrance' ? 'entrance' : 'outdoor',
            snappedPosition: activeStep?.position ?? firstStep.position,
          }
        : null

      return (
        <NavigationProvider
          location={active ? activeStep?.position ?? firstStep?.position ?? null : null}
          buildingId={active ? activeStep?.buildingId || undefined : undefined}
          floor={active ? activeStep?.floor : undefined}
          route={route}
          currentNodeId={active ? activeStep?.nodeId ?? firstStep?.nodeId ?? null : null}
          routeProgress={routeProgress}
          sessionActive={active}
          isOffRoute={active && navigationMock.isOffRoute}
          arrived={active && navigationMock.arrived}
        >
          {children}
        </NavigationProvider>
      )
    },
  }
})

vi.mock('@/components/map/QRScanSheet', () => ({
  QRScanSheet: ({
    open,
    onResolved,
  }: {
    open: boolean
    onResolved: (location: { source: 'qr'; campusId: string; label: string; nodeId: string | null; anchor: 'none' }, mode: 'start' | 'destination') => void
  }) => open ? (
    <button
      type="button"
      onClick={() => onResolved({
        source: 'qr',
        campusId: 'campus-1',
        label: 'Unanchored checkpoint',
        nodeId: null,
        anchor: 'none',
      }, 'start')}
    >
      Mock non-routable QR result
    </button>
  ) : null,
}))

vi.mock('@/hooks/useQrNavigateDeepLink', () => ({
  useQrNavigateDeepLink: () => qrNavigationMock.state,
}))

const start: NavNode = {
  id: 'start-node',
  label: 'Main Road',
  position: { lat: 11.82, lng: 122.168 },
  floor: 0,
  buildingId: '',
  campusId: 'campus-1',
  type: 'outdoor',
}

const entrance: NavNode = {
  id: 'east-entrance',
  label: 'East Upper Entrance',
  position: { lat: 11.821, lng: 122.168 },
  floor: 3,
  buildingId: 'b1',
  campusId: 'campus-1',
  type: 'entrance',
}

const destination: NavNode = {
  id: 'room-301',
  label: 'CS 301',
  position: { lat: 11.822, lng: 122.168 },
  floor: 3,
  buildingId: 'b1',
  campusId: 'campus-1',
  type: 'room',
}

const route: NavRoute = {
  path: [start.id, entrance.id, destination.id],
  steps: [
    { nodeId: start.id, label: start.label, position: start.position, floor: 0, buildingId: '', type: 'walk' },
    { nodeId: entrance.id, label: entrance.label, position: entrance.position, floor: 3, buildingId: 'b1', type: 'entrance' },
    { nodeId: destination.id, label: destination.label, position: destination.position, floor: 3, buildingId: 'b1', type: 'walk' },
  ],
  instructions: [
    { type: 'walk', text: 'Continue to East Upper Entrance', distance: 180, fromNode: start.id, toNode: entrance.id },
    { type: 'walk', text: 'Enter via East Upper Entrance', distance: 30, fromNode: entrance.id, toNode: destination.id },
    { type: 'arrive', text: 'Arrive at CS 301', distance: 0, fromNode: destination.id, toNode: destination.id },
  ],
  totalDistance: 210,
  totalDuration: 0,
  fromLabel: start.label,
  toLabel: destination.label,
  arrival: { nodeId: destination.id, label: destination.label, position: destination.position, remainingDistance: 0 },
  nodeFloors: [3, 0],
}

const campus: CampusBundle = {
  nodes: [start, entrance, destination],
  edges: [],
  searchEntries: [
    { id: 'room-entry-301', label: 'CS 301', type: 'room', nodeId: destination.id, buildingId: 'b1', floor: 3 },
  ],
  buildings: [{
    id: 'b1',
    name: 'Computer Studies Building',
    campusId: 'campus-1',
    floors: [3],
    footprint: [],
    baseElevation: 0,
    height: 12,
  }],
  components: [],
  poi: [],
  boundingBox: null,
}

const defaultFindRoute = usePublicStore.getState().findRoute
const defaultFindDestinationRoute = usePublicStore.getState().findDestinationRoute

function setReadyCampus(overrides: Partial<Parameters<typeof usePublicStore.setState>[0]> = {}) {
  usePublicStore.setState({
    campus,
    campusLoading: false,
    campusError: null,
    fromNode: null,
    toNode: null,
    poiDestination: null,
    selectedBuilding: null,
    qrLocation: null,
    sheetState: 'hidden',
    indoorContext: { active: false },
    findRoute: vi.fn(() => route),
    ...overrides,
  })
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/map/navigate')
  vi.unstubAllEnvs()
  navigationMock.arrived = false
  navigationMock.isOffRoute = false
  navigationMock.progressIndex = 0
  navigationMock.sessionPoiId = null
  navigationMock.camera = null
  qrNavigationMock.state = { status: 'idle', retry: vi.fn() }
  usePublicStore.setState({
    campus: null,
    campusLoading: false,
    campusError: null,
    fromNode: null,
    toNode: null,
    poiDestination: null,
    selectedBuilding: null,
    qrLocation: null,
    sheetState: 'hidden',
    indoorContext: { active: false },
    findRoute: defaultFindRoute,
    findDestinationRoute: defaultFindDestinationRoute,
  })
})

describe('Navigate setup and route preview', () => {
  it('starts an authored no-node POI with stable identity and cleans it on End', () => {
    setReadyCampus({
      fromNode: start.id,
      campus: {
        ...campus,
        searchEntries: [{
          id: 'poi-study-area',
          label: 'Study Area',
          type: 'poi',
          source: 'authored',
          sourceId: 'poi-study-area',
          category: 'study_area',
          position: { lat: 11.821, lng: 122.168 },
        }],
        poi: [{
          id: 'poi-study-area',
          label: 'Study Area',
          category: 'study_area',
          position: { lat: 11.821, lng: 122.168 },
          source: 'authored',
          sourceId: 'poi-study-area',
          properties: {},
          geometry: { type: 'point', position: { lat: 11.821, lng: 122.168 } },
        }],
      },
    })
    const previewRoute: NavRoute = {
      ...route,
      destination: { entityType: 'poi', entityId: 'poi-study-area' },
      path: [start.id, 'poi-study-area'],
      steps: [
        route.steps[0],
        { nodeId: 'poi-study-area', label: 'Study Area', position: { lat: 11.821, lng: 122.1677 }, floor: 0, buildingId: '', type: 'walk' },
      ],
      instructions: [
        route.instructions[0],
        { type: 'arrive', text: 'Arrive at Study Area', distance: 0, fromNode: 'poi-study-area', toNode: 'poi-study-area' },
      ],
      toLabel: 'Study Area',
      arrival: { nodeId: 'poi-study-area', label: 'Study Area', position: { lat: 11.821, lng: 122.1677 }, remainingDistance: 0 },
    }
    const findDestinationRoute = vi.fn(() => previewRoute)
    usePublicStore.setState({ findDestinationRoute })
    const topologyBefore = JSON.stringify({
      nodes: usePublicStore.getState().campus?.nodes,
      edges: usePublicStore.getState().campus?.edges,
    })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Search building, room, or place' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search destination' }), {
      target: { value: 'Study Area' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose Study Area' }))

    const state = usePublicStore.getState() as typeof usePublicStore extends never ? never : {
      toNode: string | null
      poiDestination?: { destinationType: 'poi'; poiId: string } | null
    }
    expect(state.toNode).toBeNull()
    expect(state.poiDestination).toEqual({ destinationType: 'poi', poiId: 'poi-study-area' })
    expect(screen.getByText('Route preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeInTheDocument()

    const callsBeforeStart = findDestinationRoute.mock.calls.length
    navigationMock.progressIndex = 1
    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

    expect(findDestinationRoute).toHaveBeenCalledTimes(callsBeforeStart)
    expect(screen.getByText('Active navigation')).toBeInTheDocument()
    expect(navigationMock.sessionPoiId).toBe('poi-study-area')
    expect(screen.getByText('Continue to Study Area')).toBeInTheDocument()
    expect(screen.getByText('Study Area')).toBeInTheDocument()
    expect(JSON.stringify({
      nodes: usePublicStore.getState().campus?.nodes,
      edges: usePublicStore.getState().campus?.edges,
    })).toBe(topologyBefore)

    fireEvent.click(screen.getByRole('button', { name: 'End navigation' }))
    expect(usePublicStore.getState().poiDestination).toBeNull()
    expect(usePublicStore.getState().toNode).toBeNull()
    expect(JSON.stringify({
      nodes: usePublicStore.getState().campus?.nodes,
      edges: usePublicStore.getState().campus?.edges,
    })).toBe(topologyBefore)
  })

  it('hands a resolved QR location to setup without auto-starting navigation', () => {
    qrNavigationMock.state = {
      status: 'resolved',
      location: {
        source: 'qr',
        campusId: 'campus-1',
        checkpointId: 'north-gate',
        label: 'North Gate',
        nodeId: null,
        anchor: 'none',
      },
      retry: vi.fn(),
    }
    setReadyCampus()
    render(<NavigatePage />)

    expect(screen.getByRole('button', { name: 'From North Gate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start navigation' })).toBeNull()
  })

  it('exposes a retryable QR failure without creating a route or starting navigation', () => {
    const retry = vi.fn()
    qrNavigationMock.state = {
      status: 'error',
      reason: 'unknown',
      checkpointId: 'missing-checkpoint',
      message: 'This QR location is not recognized.',
      retry,
    }
    setReadyCampus()
    render(<NavigatePage />)

    expect(screen.getByRole('alert')).toHaveTextContent('This QR location is not recognized.')
    fireEvent.click(screen.getByRole('button', { name: 'Try QR again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Start navigation' })).toBeNull()
  })

  it('does not replace an existing origin when a scanner result has no routing anchor', () => {
    setReadyCampus({ fromNode: start.id })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Scan a NAVI code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock non-routable QR result' }))

    expect(usePublicStore.getState().fromNode).toBe(start.id)
    expect(usePublicStore.getState().qrLocation).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('QR location found, but no routing anchor is published')
  })

  it('opens map-first with compact destination setup and the idle camera seam', () => {
    setReadyCampus()
    render(<NavigatePage />)

    expect(screen.queryByRole('heading', { name: 'Navigate' })).toBeNull()
    expect(screen.queryByText('Where do you want to go?')).toBeNull()
    expect(screen.queryByText('Map ready')).toBeNull()
    expect(screen.queryByText('Destination', { exact: true })).toBeNull()
    expect(screen.getByRole('button', { name: 'Search building, room, or place' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan a NAVI code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set starting point' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use my current location' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Swap start and destination' })).toBeNull()
    expect(screen.getByTestId('navigate-map-stub')).toBeInTheDocument()
    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-surface', 'active')
    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-mode', 'TOP')
    expect(screen.queryByRole('group', { name: 'Route setup' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start navigation' })).toBeNull()
  })

  it('renders the development simulator only behind the explicit non-production flag', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_NAVI_DEV_LOCATION', '1')
    setReadyCampus()
    render(<NavigatePage />)

    expect(screen.getByTestId('navigation-dev-panel')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Simulated heading' })).toHaveValue('0')

    cleanup()
    vi.stubEnv('NODE_ENV', 'production')
    render(<NavigatePage />)

    expect(screen.queryByTestId('navigation-dev-panel')).toBeNull()
  })

  it('hands off a stable destination into route-preview without starting active guidance', () => {
    setReadyCampus({ fromNode: start.id })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Search building, room, or place' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search destination' }), {
      target: { value: 'CS 301' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose CS 301' }))

    expect(usePublicStore.getState().toNode).toBe(destination.id)
    expect(screen.getByText('Route preview')).toBeInTheDocument()
    expect(screen.getByTestId('navigate-map-stub')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeInTheDocument()
    expect(screen.getByText('CS 301')).toBeInTheDocument()
    expect(screen.queryByText('Active navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: 'End navigation' })).toBeNull()
  })

  it('keeps route preview TOP-only and passes route bounds to the camera seam', () => {
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    const map = screen.getByTestId('navigate-map-stub')
    expect(map).toHaveAttribute('data-camera-surface', 'route-preview')
    expect(map).toHaveAttribute('data-camera-mode', 'TOP')
    expect(map).toHaveAttribute('data-camera-has-bounds', 'true')
  })

  it('shows an explicit route failure instead of a fake preview', () => {
    setReadyCampus({
      fromNode: start.id,
      toNode: destination.id,
      findRoute: vi.fn(() => null),
    })
    render(<NavigatePage />)

    expect(screen.getByText('No route is currently available to this destination.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start navigation' })).toBeNull()
    expect(screen.queryByTestId('navigate-map-stub')).toBeInTheDocument()
  })

  it('does not preview or start an ordinary zero-distance route', () => {
    setReadyCampus({
      fromNode: start.id,
      toNode: destination.id,
      findRoute: vi.fn(() => ({ ...route, totalDistance: 0 })),
    })
    render(<NavigatePage />)

    expect(screen.getByText('No route is currently available to this destination.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start navigation' })).toBeNull()
    expect(screen.queryByTestId('navigate-map-stub')).toBeInTheDocument()
  })

  it('hands off a recent destination through the same stable search entry', () => {
    setReadyCampus({ fromNode: start.id, recentDestinations: [destination.id] })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose recent destination CS 301' }))

    expect(usePublicStore.getState().toNode).toBe(destination.id)
    expect(screen.getByText('Route preview')).toBeInTheDocument()
  })

  it('shows a truthful location-unavailable state without inventing an origin', () => {
    const originalGeolocation = navigator.geolocation
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    })

    try {
      setReadyCampus()
      render(<NavigatePage />)
      fireEvent.click(screen.getByRole('button', { name: 'Set starting point' }))
      fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }))

      expect(screen.getByText('Location unavailable')).toBeInTheDocument()
      expect(usePublicStore.getState().fromNode).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: originalGeolocation,
      })
    }
  })

  it('shows Swap only in route preview when both endpoints exist', () => {
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    const swap = screen.getByRole('button', { name: 'Swap start and destination' })
    expect(swap).toBeInTheDocument()
    fireEvent.click(swap)

    expect(usePublicStore.getState().fromNode).toBe(destination.id)
    expect(usePublicStore.getState().toNode).toBe(start.id)
  })

  it('moves to active navigation only after Start navigation is pressed', () => {
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    expect(screen.getByText('Route preview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

    expect(screen.getByText('Active navigation')).toBeInTheDocument()
    expect(screen.getByText('Next instruction')).toBeInTheDocument()
    expect(screen.getByText('210 m remaining')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next instruction' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mute voice guidance' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /360|panorama/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start navigation' })).toBeNull()
  })

  it('applies the stored camera view only after Start navigation', () => {
    const current = usePublicStore.getState().preferences
    usePublicStore.setState({
      preferences: {
        ...current,
        navigation: { ...current.navigation, defaultMapView: 'pov' },
      },
    })
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-mode', 'TOP')
    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-surface', 'active')
    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-mode', 'POV')
  })

  it('wires active camera mode changes back into Navigate state', () => {
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))
    expect(navigationMock.camera?.onModeChange).toEqual(expect.any(Function))

    act(() => navigationMock.camera?.onModeChange?.('FOLLOW'))
    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-mode', 'FOLLOW')

    act(() => navigationMock.camera?.onModeChange?.('POV'))
    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-mode', 'POV')
  })

  it('keeps Heading Follow live in setup and carries a setup toggle into active navigation', () => {
    const previousPreferences = usePublicStore.getState().preferences
    usePublicStore.setState({
      preferences: {
        ...previousPreferences,
        navigation: { ...previousPreferences.navigation, headingFollow: false },
      },
    })
    setReadyCampus()

    try {
      render(<NavigatePage />)
      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-heading-follow', 'false')
      expect(navigationMock.camera?.onToggleHeadingFollow).toEqual(expect.any(Function))

      act(() => navigationMock.camera?.onToggleHeadingFollow?.(true))

      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-heading-follow', 'true')
      expect(usePublicStore.getState().preferences.navigation.headingFollow).toBe(true)

      act(() => usePublicStore.setState({ fromNode: start.id, toNode: destination.id }))
      fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-heading-follow', 'true')
    } finally {
      cleanup()
      usePublicStore.setState({ preferences: previousPreferences })
    }
  })

  it('auto-enables and persists Heading Follow when POV is selected', () => {
    const previousPreferences = usePublicStore.getState().preferences
    usePublicStore.setState({
      preferences: {
        ...previousPreferences,
        navigation: {
          ...previousPreferences.navigation,
          defaultMapView: 'top',
          headingFollow: false,
        },
      },
    })
    setReadyCampus({ fromNode: start.id, toNode: destination.id })

    try {
      render(<NavigatePage />)
      fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))
      expect(navigationMock.camera?.onModeChange).toEqual(expect.any(Function))

      act(() => navigationMock.camera?.onModeChange?.('POV'))

      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-mode', 'POV')
      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-heading-follow', 'true')
      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-top-orientation', 'heading-follow')
      expect(usePublicStore.getState().preferences.navigation.headingFollow).toBe(true)
    } finally {
      cleanup()
      usePublicStore.setState({ preferences: previousPreferences })
    }
  })

  it('restores the stored Heading Follow preference when active navigation ends', () => {
    const previousPreferences = usePublicStore.getState().preferences
    usePublicStore.setState({
      preferences: {
        ...previousPreferences,
        navigation: { ...previousPreferences.navigation, headingFollow: true },
      },
    })
    setReadyCampus({ fromNode: start.id, toNode: destination.id })

    try {
      render(<NavigatePage />)
      fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))
      fireEvent.click(screen.getByRole('button', { name: 'End navigation' }))

      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-heading-follow', 'true')
      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-top-orientation', 'heading-follow')
      expect(usePublicStore.getState().preferences.navigation.headingFollow).toBe(true)
    } finally {
      cleanup()
      usePublicStore.setState({ preferences: previousPreferences })
    }
  })

  it('applies the stored heading-follow preference before and during navigation', () => {
    const previousPreferences = usePublicStore.getState().preferences
    usePublicStore.setState({
      preferences: {
        ...previousPreferences,
        navigation: { ...previousPreferences.navigation, headingFollow: true },
      },
    })
    setReadyCampus({ fromNode: start.id, toNode: destination.id })

    try {
      render(<NavigatePage />)
      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-heading-follow', 'true')

      fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

      expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-heading-follow', 'true')
    } finally {
      cleanup()
      usePublicStore.setState({ preferences: previousPreferences })
    }
  })

  it('keeps manual instruction preview separate from authoritative progress', () => {
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))
    expect(screen.getByText('Current progress: Step 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('Continue to East Upper Entrance')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next instruction' }))

    expect(screen.getByText('Viewing step 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Enter via East Upper Entrance')).toBeInTheDocument()
    expect(screen.getByText('Current progress: Step 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Return to current step' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Return to current step' }))

    expect(screen.getByText('Continue to East Upper Entrance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Return to current step' })).toBeNull()
  })

  it('enters the route-selected building and floor only during active navigation', () => {
    navigationMock.progressIndex = 1
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    expect(usePublicStore.getState().indoorContext.active).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

    expect(usePublicStore.getState().indoorContext).toMatchObject({
      active: true,
      buildingId: 'b1',
      floorId: 3,
    })

    fireEvent.click(screen.getByRole('button', { name: 'End navigation' }))

    expect(usePublicStore.getState().indoorContext.active).toBe(false)
    expect(usePublicStore.getState().activeFloor).toBe(0)
  })

  it('shows exact arrival context and end navigation returns to setup', () => {
    navigationMock.arrived = true
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

    expect(screen.getByText("You've arrived at your destination.")).toBeInTheDocument()
    expect(screen.getByText('CS 301 · Computer Studies Building · 3F')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start 360' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'End navigation' }))

    expect(screen.getByRole('button', { name: 'Search building, room, or place' })).toBeInTheDocument()
    expect(screen.queryByTestId('navigate-map-stub')).toBeInTheDocument()
    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-surface', 'active')
    expect(screen.getByTestId('navigate-map-stub')).toHaveAttribute('data-camera-mode', 'TOP')
    expect(usePublicStore.getState().fromNode).toBeNull()
    expect(usePublicStore.getState().toNode).toBeNull()
    expect(usePublicStore.getState().indoorContext.active).toBe(false)
    expect(usePublicStore.getState().activeFloor).toBe(0)
  })

  it('does not present off-route together with arrival', () => {
    navigationMock.arrived = true
    navigationMock.isOffRoute = true
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))

    expect(screen.getByText("You've arrived at your destination.")).toBeInTheDocument()
    expect(screen.queryByText("You're off the route.")).toBeNull()
  })

  it('clears route query parameters on End and does not recreate the route on refresh', () => {
    window.history.replaceState(null, '', '/map/navigate?from=start-node&to=room-301&ref=profile')
    setReadyCampus({ fromNode: start.id, toNode: destination.id })
    render(<NavigatePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Start navigation' }))
    fireEvent.click(screen.getByRole('button', { name: 'End navigation' }))

    expect(window.location.pathname).toBe('/map/navigate')
    expect(window.location.search).toBe('?ref=profile')
    expect(usePublicStore.getState().fromNode).toBeNull()
    expect(usePublicStore.getState().toNode).toBeNull()

    cleanup()
    render(<NavigatePage />)

    expect(screen.getByRole('button', { name: 'Search building, room, or place' })).toBeInTheDocument()
    expect(screen.queryByTestId('navigate-map-stub')).toBeInTheDocument()
  })
})
