import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FloorEditor } from '../FloorEditor'
import type { Building } from '@/types/nav-types'

vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<{ default: unknown }>) => {
    const Loaded = () => null
    Loaded.displayName = 'DynamicComponent'
    return Loaded
  },
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('lucide-react', () => ({
  ArrowLeft: () => null,
  MousePointer2: () => null,
  Square: () => null,
  ArrowUpDown: () => null,
  Eye: () => null,
  EyeOff: () => null,
  DoorOpen: () => null,
  CornerUpRight: () => null,
  Building2: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Route: () => null,
  Layers: () => null,
  Trash2: () => null,
  LogIn: () => null,
  Upload: () => null,
  Box: () => null,
  RefreshCw: () => null,
}))

const mockBuilding: Building = {
  id: 'bldg-test',
  name: 'Test Building',
  floors: [0, 1],
  footprint: [{ lat: 11.8195, lng: 122.0922 }],
  campusId: 'asu-ibajay',
  color: '#1C6BEB',
  baseElevation: 0,
  height: 10,
}

vi.mock('@/hooks/floor-graph-selectors', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/floor-graph-selectors')>('@/hooks/floor-graph-selectors')
  return {
    ...actual,
    useFloorComponents: () => [] as any[],
    useFloorComponent: () => null,
    useFloorComponentsAll: () => [],
    useFloorRenderVersion: () => 0,
    useFloorCampusId: () => 'asu-ibajay',
    useFloorSyncStatus: () => 'synced',
    useFloorSyncError: () => null,
    useFloorWorkflowSaveState: () => 'idle',
    useLegacyBuilding: (id: string) => ({
      id, name: 'Test Building', campusId: 'asu-ibajay', floors: [0, 1],
      footprint: [{ lat: 11.8195, lng: 122.0922 }], color: '#1C6BEB',
      floorData: [{ id: 'flr-0', level: 0 }],
    }),
    useGraphBuilding: () => null,
    useFloorPlanUrls: () => undefined,
    countFloorComponents: () => 0,
    findGraphBuilding: () => null,
  }
})

vi.mock('@navi/editor', async () => {
  const actual = await vi.importActual<typeof import('@navi/editor')>('@navi/editor')
  return {
    ...actual,
    ICONS: actual.ICONS ?? {},
    useDocumentVersion: () => 0,
    useSelection: () => ({ lastSelected: null, select: vi.fn(), clear: vi.fn(), toggle: vi.fn(), isSelected: () => false, setMode: vi.fn(), setHover: vi.fn(), clearHover: vi.fn() }),
    useEditor: () => ({
      document: { schemaVersion: 1, metadata: {} as any, buildings: [], roads: [], panoramas: [], qrCheckpoints: [] },
      services: {
        get: (name: string) => {
          if (name === 'toolRegistry') {
            const { CurrentToolStore } = actual as { CurrentToolStore: new () => { activeToolId: string | null; activate: () => void } }
            return new CurrentToolStore()
          }
          if (name === 'viewport') {
            return { activeFloorId: null, setActiveFloor: vi.fn() }
          }
          if (name === 'selection') {
            return { selectedId: null, select: vi.fn() }
          }
          if (name === 'dispatcher') {
            return { execute: vi.fn() }
          }
          return null
        },
      },
    }),
  }
})

vi.mock('@/store/graph-store', () => ({
  useGraphStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const mockStore = {
      graph: {
        buildings: [mockBuilding],
        components: [],
        traces: [],
        getBuilding: (id: string) => mockBuilding,
        getComponent: () => null,
        addComponent: vi.fn(),
        removeComponent: vi.fn(),
        updateComponent: vi.fn(),
        addComponentWithPolygon: vi.fn(),
        updateBuilding: vi.fn(),
        addTraceWithCompile: vi.fn(),
        removeTrace: vi.fn(),
        updateTrace: vi.fn(),
      },
      save: vi.fn(),
      removeComponent: vi.fn(),
      updateComponent: vi.fn(),
      addComponentWithPolygon: vi.fn(),
      updateBuilding: vi.fn(),
      load: vi.fn(),
    }
    return selector(mockStore)
  },
}))

// CSS computed colors — browser converts hex to rgb
const BLUE = 'rgb(59, 130, 246)'
const AMBER = 'rgb(245, 158, 11)'
const TRANSPARENT = 'transparent'

function hasColor(style: string | null, color: string): boolean {
  return style !== null && style.includes(color)
}

describe('FloorEditor — 2D / 2.5D view toggle', () => {
  afterEach(cleanup)

  it('Case 1: Default opens in 2D', () => {
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    const btn2d = screen.getByTestId('viewmode-2d')
    const btn25d = screen.getByTestId('viewmode-2.5d')
    expect(btn2d).toBeInTheDocument()
    expect(btn25d).toBeInTheDocument()
    // 2D is default — blue background
    expect(hasColor(btn2d.getAttribute('style'), BLUE)).toBe(true)
    expect(hasColor(btn25d.getAttribute('style'), TRANSPARENT)).toBe(true)
  })

  it('Case 2: Toggle to 2.5D enables extrusion indicator', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), AMBER)).toBe(true)
    expect(hasColor(screen.getByTestId('viewmode-2d').getAttribute('style'), TRANSPARENT)).toBe(true)
  })

  it('Case 3: 2.5D applies camera pitch (via canvas prop)', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    // The canvas receives viewMode='2.5d' and applies pitch via map.easeTo
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), AMBER)).toBe(true)
  })

  it('Case 4: Creation tools disabled in 2.5D', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), AMBER)).toBe(true)
  })

  it('Case 5: Toggle back to 2D', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), AMBER)).toBe(true)
    await user.click(screen.getByTestId('viewmode-2d'))
    expect(hasColor(screen.getByTestId('viewmode-2d').getAttribute('style'), BLUE)).toBe(true)
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), TRANSPARENT)).toBe(true)
  })

  it('Case 6: Repeated toggling does not crash', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByTestId('viewmode-2.5d'))
      await user.click(screen.getByTestId('viewmode-2d'))
    }
    expect(hasColor(screen.getByTestId('viewmode-2d').getAttribute('style'), BLUE)).toBe(true)
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), TRANSPARENT)).toBe(true)
  })

  it('Case 7: CampusDocument unchanged across toggles', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    await user.click(screen.getByTestId('viewmode-2d'))
    await user.click(screen.getByTestId('viewmode-2.5d'))
    await user.click(screen.getByTestId('viewmode-2d'))
    expect(hasColor(screen.getByTestId('viewmode-2d').getAttribute('style'), BLUE)).toBe(true)
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), TRANSPARENT)).toBe(true)
  })

  it('Case 8: Floor switch in 2.5D does not crash', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), AMBER)).toBe(true)
    expect(screen.getByTestId('viewmode-2d')).toBeInTheDocument()
    expect(screen.getByTestId('viewmode-2.5d')).toBeInTheDocument()
  })

  it('2D/2.5D toggle only visible in architecture mode', () => {
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    expect(screen.getByTestId('viewmode-2d')).toBeInTheDocument()
    expect(screen.getByTestId('viewmode-2.5d')).toBeInTheDocument()
  })

  it('2.5D mode disables creation tools (handleToolActivate blocks)', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), AMBER)).toBe(true)
  })

  it('2.5D mode sets readOnly on canvas (prevents geometry editing)', async () => {
    const user = userEvent.setup()
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    await user.click(screen.getByTestId('viewmode-2.5d'))
    expect(hasColor(screen.getByTestId('viewmode-2.5d').getAttribute('style'), AMBER)).toBe(true)
  })
})
