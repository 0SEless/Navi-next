import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { FloorEditor } from '../FloorEditor'
import type { Building, Component } from '@/types/nav-types'

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

let graphComponents: Component[] = []

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
        components: graphComponents,
        traces: [],
        getBuilding: (id: string) => mockBuilding,
        getComponent: (id: string) => graphComponents.find((c) => c.id === id as string) ?? null,
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

describe('FloorEditor - React #185 diagnostic', () => {
  const originalConsoleError = console.error
  const errorCalls: unknown[][] = []

  beforeEach(() => {
    errorCalls.length = 0
    console.error = (...args: unknown[]) => {
      errorCalls.push(args)
      originalConsoleError(...args)
    }
  })

  afterEach(() => {
    console.error = originalConsoleError
    cleanup()
  })

  it('renders without console.error calls', () => {
    render(<FloorEditor mapId="map-test" buildingId="bldg-test" floor={0} />)
    // If React #185 fires, it will be captured in errorCalls
    const reactErrors = errorCalls.filter(
      (args) => args.some((a) => typeof a === 'string' && a.includes('Cannot update'))
    )
    expect(reactErrors).toHaveLength(0)
  })
})
