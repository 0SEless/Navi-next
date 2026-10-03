import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ComponentProperties } from '../ComponentProperties'
import { FloorOutliner } from '../FloorOutliner'
import type { Building, Component } from '@/types/nav-types'

const mocks = vi.hoisted(() => ({
  component: null as Component | null,
  components: [] as Component[],
  document: { buildings: [], roads: [] } as any,
  graphNodes: [] as any[],
  execute: vi.fn(),
  begin: vi.fn(),
  doCommit: vi.fn(),
}))

vi.mock('@/hooks/floor-graph-selectors', () => ({
  useFloorComponent: () => mocks.component,
  useFloorComponentsAll: () => (mocks.components.length > 0 ? mocks.components : mocks.component ? [mocks.component] : []),
  isSemanticRoomComponent: (component: Component | null | undefined) => component?.metadata?.source === 'derived-face' && component?.metadata?.semanticRoom === true,
}))

vi.mock('@/store/graph-store', () => ({
  useGraphStore: (selector: (state: { graph: { nodes: any[] } }) => unknown) => selector({ graph: { nodes: mocks.graphNodes } }),
}))

vi.mock('@navi/editor', () => ({
  useDocumentVersion: () => 0,
  useEditor: () => ({
    document: mocks.document,
    services: { get: (name: string) => name === 'dispatcher' ? { execute: mocks.execute } : undefined },
  }),
  useEditingEngine: () => ({ begin: mocks.begin, doCommit: mocks.doCommit }),
  RelationshipService: class {},
  RelationshipSuggestionService: class {
    suggestEntranceRoad() { return [] }
  },
}))

vi.mock('../InteractionContext', () => ({
  useInteraction: () => ({ enterRelationshipSelection: vi.fn() }),
}))

const semanticRoom = (): Component => ({
  id: 'room-semantic-1',
  type: 'room',
  name: 'Room',
  buildingId: 'building-1',
  campusId: 'campus-1',
  floor: 0,
  position: { lat: 1.33, lng: 1.67 },
  polygon: [
    { lat: 1, lng: 1 },
    { lat: 1, lng: 2 },
    { lat: 2, lng: 2 },
  ],
  metadata: {
    source: 'derived-face',
    semanticRoom: true,
    floorId: 'floor-1',
    faceId: 'face-1',
    roomId: 'room-semantic-1',
    type: 'classroom',
    code: '101',
    description: 'A teaching room',
    searchable: true,
  },
})

const routeNode = (): Component => ({
  id: 'route-node-1',
  type: 'route-node',
  name: 'Route Node route-node-1',
  buildingId: 'building-1',
  campusId: 'campus-1',
  floor: 0,
  position: { lat: 1.33, lng: 1.67 },
  metadata: {
    routeEntity: 'node',
    nodeId: 'route-node-1',
    nodeType: 'waypoint',
    floor: 0,
    localPosition: { x: 12, y: 8 },
    floorId: 'floor-1',
  },
})

const routeEdge = (): Component => ({
  id: 'route-edge-1',
  type: 'route-edge',
  name: 'Route segment 1',
  buildingId: 'building-1',
  campusId: 'campus-1',
  floor: 0,
  position: { lat: 1.34, lng: 1.68 },
  metadata: {
    routeEntity: 'edge',
    edgeId: 'route-edge-1',
    from: 'route-node-1',
    to: 'route-node-2',
    floor: 0,
    floorId: 'floor-1',
  },
})

const hallway = (): Component => ({
  id: 'hallway-1',
  type: 'hallway',
  name: 'Main Hallway',
  buildingId: 'building-1',
  campusId: 'campus-1',
  floor: 0,
  position: { lat: 1.3, lng: 1.6 },
})

const building: Building = {
  id: 'building-1',
  name: 'Test Building',
  campusId: 'campus-1',
  floors: [0],
  footprint: [],
  baseElevation: 0,
  height: 3,
}

function editorDocument() {
  return {
    buildings: [{
      id: 'building-1',
      floors: [{
        id: 'floor-1',
        level: 0,
        entrances: [{ id: 'entrance-1', label: 'Main Entrance', position: { x: 0, y: 0 }, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        connectorStops: [],
        parametricComponents: [],
        roomAttributes: [{ faceId: 'face-1', roomId: 'room-semantic-1', name: 'Room', searchable: true }],
        routeNetwork: {
          nodes: [
            { id: 'route-node-1', type: 'waypoint', position: { x: 4, y: 5 }, floor: 0 },
            { id: 'route-node-2', type: 'waypoint', position: { x: 8, y: 9 }, floor: 0 },
          ],
          edges: [],
        },
      }],
    }],
    roads: [],
  }
}

beforeEach(() => {
  mocks.component = semanticRoom()
  mocks.components = []
  mocks.document = editorDocument()
  mocks.graphNodes = [{ id: 'outdoor-node-7', type: 'outdoor', name: 'North Campus Walk', position: { lat: 11.81, lng: 122.09 } }]
  mocks.execute.mockReset()
  mocks.begin.mockReset()
  mocks.doCommit.mockReset()
})

afterEach(cleanup)

describe('semantic Room projected properties', () => {
  it('edits canonical RoomAttributes fields without exposing legacy polygon dimensions', () => {
    render(<ComponentProperties componentId="room-semantic-1" onClose={vi.fn()} />)

    expect(screen.getByDisplayValue('101')).toBeInTheDocument()
    expect(screen.getByDisplayValue('classroom')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A teaching room')).toBeInTheDocument()
    expect(screen.getByLabelText('Searchable')).toBeChecked()
    expect(screen.queryByText('WIDTH')).not.toBeInTheDocument()
    expect(screen.queryByText('HEIGHT')).not.toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('Room'), { target: { value: 'Lecture Room' } })
    fireEvent.change(screen.getByLabelText('Room type'), { target: { value: 'laboratory' } })
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: '202' } })
    fireEvent.change(screen.getByLabelText('Room description'), { target: { value: 'Updated teaching room' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'roomAttributes.update',
      payload: {
        buildingId: 'building-1',
        floorId: 'floor-1',
        roomId: 'room-semantic-1',
        faceId: 'face-1',
        changes: { name: 'Lecture Room', type: 'laboratory', code: '202', description: 'Updated teaching room', searchable: true },
      },
    }))
    expect(mocks.begin).not.toHaveBeenCalled()
  })

  it('saves the same canonical update when Enter is pressed in a Room property field', () => {
    render(<ComponentProperties componentId="room-semantic-1" onClose={vi.fn()} />)

    fireEvent.change(screen.getByDisplayValue('Room'), { target: { value: 'Enter Room' } })
    fireEvent.keyDown(screen.getByDisplayValue('Enter Room'), { key: 'Enter', code: 'Enter' })

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'roomAttributes.update',
      payload: expect.objectContaining({
        buildingId: 'building-1',
        floorId: 'floor-1',
        roomId: 'room-semantic-1',
        faceId: 'face-1',
        changes: { name: 'Enter Room', type: 'classroom', code: '101', description: 'A teaching room', searchable: true },
      }),
    }))
  })

  it('checks Searchable by default and explains the effect through the help control', () => {
    const component = semanticRoom()
    delete component.metadata!.searchable
    mocks.component = component

    render(<ComponentProperties componentId="room-semantic-1" onClose={vi.fn()} />)

    expect(screen.getByLabelText('Searchable')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'What does searchable mean?' }))

    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Searchable Rooms can be found by campus users through search using the room name, code, or description.',
    )
  })

  it('unassigns semantic metadata without deleting the derived face', () => {
    const onClose = vi.fn()
    render(<ComponentProperties componentId="room-semantic-1" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Room' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'roomAttributes.unassign',
      payload: expect.objectContaining({ buildingId: 'building-1', floorId: 'floor-1', roomId: 'room-semantic-1', faceId: 'face-1' }),
    }))
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('assigns a point-only Room access to an existing route node', () => {
    render(<ComponentProperties componentId="room-semantic-1" onClose={vi.fn()} />)

    expect(screen.getByText('ROUTE ACCESS')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Room access route node' }), { target: { value: 'route-node-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign Room Access' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'room.access.assign',
      payload: {
        buildingId: 'building-1',
        floorId: 'floor-1',
        roomId: 'room-semantic-1',
        faceId: 'face-1',
        routeNodeId: 'route-node-2',
        primary: true,
      },
    }))
  })

  it('removes an existing point-only Room access through the access command', () => {
    mocks.document.buildings[0].floors[0].roomAttributes[0].accessPoints = [{ routeNodeId: 'route-node-1', primary: true }]
    render(<ComponentProperties componentId="room-semantic-1" onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove route access route-node-1' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'room.access.unassign',
      payload: { buildingId: 'building-1', floorId: 'floor-1', roomId: 'room-semantic-1', faceId: 'face-1', routeNodeId: 'route-node-1' },
    }))
  })
})

describe('semantic Room projected outliner item', () => {
  it('marks derived Rooms and routes delete affordance to unassign', () => {
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId="room-semantic-1" onSelect={vi.fn()} />)

    expect(screen.getByText('derived')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Room' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'roomAttributes.unassign' }))
    expect(mocks.begin).not.toHaveBeenCalled()
  })

  it('collapses and expands component type groups without losing selection', () => {
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId="room-semantic-1" onSelect={vi.fn()} />)

    expect(screen.getByText('Room')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Rooms' }))
    expect(screen.queryByText('Room')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Rooms' }))
    expect(screen.getByText('Room')).toBeInTheDocument()
  })

  it('dispatches the room-ownership reconcile from the Outliner header', () => {
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId={null} onSelect={vi.fn()} activeFloorId="floor-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reconcile room ownership' }))

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const [command, options] = mocks.execute.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(command).toEqual({
      id: 'door.ownership.reconcile',
      label: 'Reconcile Room Ownership',
      payload: { buildingId: 'building-1', floorId: 'floor-1' },
    })
    expect(options).toBeUndefined()
  })

  it('hides the reconcile action when the active floor id is missing', () => {
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId={null} onSelect={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Reconcile room ownership' })).toBeNull()
  })
})

describe('legacy hallway outliner item', () => {
  it('lists a legacy hallway as a row under the Hallways floor group', () => {
    mocks.components = [semanticRoom(), hallway()]
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId={null} onSelect={vi.fn()} />)

    expect(screen.getByText('Hallways (1)')).toBeInTheDocument()
    expect(screen.getByText('Main Hallway')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Hallways' }))
    expect(screen.queryByText('Main Hallway')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Hallways' }))
    expect(screen.getByText('Main Hallway')).toBeInTheDocument()
  })
})

describe('route graph projected properties', () => {
  it('shows route-node properties and deletes through the route command', () => {
    mocks.component = routeNode()
    render(<ComponentProperties componentId="route-node-1" onClose={vi.fn()} />)

    expect(screen.getByText('Route Node')).toBeInTheDocument()
    expect(screen.getByText('POSITION')).toBeInTheDocument()
    expect(screen.getByText(/12\.0, 8\.0/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'route.node.delete',
      payload: { nodeId: 'route-node-1' },
    }))
    expect(mocks.begin).not.toHaveBeenCalled()
  })

  it('lists route nodes inside a collapsed Navigation parent', () => {
    mocks.component = routeNode()
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId={null} onSelect={vi.fn()} />)

    expect(screen.queryByText('Route Nodes (1)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Navigation' }))
    expect(screen.getByText('Route Nodes (1)')).toBeInTheDocument()
    expect(screen.queryByText('Route Node route-node-1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Route Nodes' }))
    expect(screen.getByText('Route Node route-node-1')).toBeInTheDocument()
  })

  it('keeps Route Nodes and Route Edges under the collapsible Navigation parent', () => {
    mocks.components = [routeNode(), routeEdge()]
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId={null} onSelect={vi.fn()} />)

    expect(screen.queryByText('Route Nodes (1)')).not.toBeInTheDocument()
    expect(screen.queryByText('Route Edges (1)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Navigation' }))
    expect(screen.getByText('Route Nodes (1)')).toBeInTheDocument()
    expect(screen.getByText('Route Edges (1)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Navigation' }))
    expect(screen.queryByText('Route Nodes (1)')).not.toBeInTheDocument()
    expect(screen.queryByText('Route Edges (1)')).not.toBeInTheDocument()
  })

  it('nests assigned Doors beneath their Room inside a Doors subfolder and keeps unassigned Doors top-level', () => {
    const assignedDoor: Component = { id: 'door-assigned', type: 'door', name: 'Assigned Door', buildingId: 'building-1', floor: 0, position: { lat: 1, lng: 1 }, metadata: { roomId: 'room-semantic-1', ownershipStatus: 'assigned' } }
    const unassignedDoor: Component = { id: 'door-unassigned', type: 'door', name: 'Unassigned Door', buildingId: 'building-1', floor: 0, position: { lat: 2, lng: 2 }, metadata: { ownershipStatus: 'unassigned' } }
    mocks.components = [semanticRoom(), assignedDoor, unassignedDoor]
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId={null} onSelect={vi.fn()} />)

    const roomDoorsGroup = screen.getByText('Doors (1)').closest('div') as HTMLElement
    expect(within(roomDoorsGroup).getByText('Assigned Door')).toBeInTheDocument()
    const unassignedDoorsGroup = screen.getByText('Unassigned Doors (1)').closest('div') as HTMLElement
    expect(within(unassignedDoorsGroup).getByText('Unassigned Door')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Room Room' }))
    expect(screen.queryByText('Assigned Door')).not.toBeInTheDocument()
    expect(screen.getByText('Unassigned Door')).toBeInTheDocument()
  })

  it('collapses and expands a Room child subfolder without losing selection', () => {
    const assignedDoor: Component = { id: 'door-assigned', type: 'door', name: 'Assigned Door', buildingId: 'building-1', floor: 0, position: { lat: 1, lng: 1 }, metadata: { roomId: 'room-semantic-1', ownershipStatus: 'assigned' } }
    mocks.components = [semanticRoom(), assignedDoor]
    render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId="room-semantic-1" onSelect={vi.fn()} />)

    expect(screen.getByText('Assigned Door')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Doors' }))
    expect(screen.queryByText('Assigned Door')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Doors' }))
    expect(screen.getByText('Assigned Door')).toBeInTheDocument()
  })

  it('auto-expands the nested Rooms → Room → Doors path for a selected assigned Door', () => {
    const assignedDoor: Component = { id: 'door-assigned', type: 'door', name: 'Assigned Door', buildingId: 'building-1', floor: 0, position: { lat: 1, lng: 1 }, metadata: { roomId: 'room-semantic-1', ownershipStatus: 'assigned' } }
    mocks.components = [semanticRoom(), assignedDoor]
    const { rerender } = render(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId={null} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Doors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Room Room' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Rooms' }))
    expect(screen.queryByText('Assigned Door')).not.toBeInTheDocument()

    rerender(<FloorOutliner building={building} activeFloor={0} mapId="map-1" selectedId="door-assigned" onSelect={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Collapse Rooms' })).toBeInTheDocument()
    expect(screen.getByText('Assigned Door')).toBeInTheDocument()
  })
})

describe('entrance route access properties', () => {
  const entrance = (): Component => ({
    id: 'entrance-1',
    type: 'entrance',
    name: 'Main Entrance',
    buildingId: 'building-1',
    campusId: 'campus-1',
    floor: 0,
    position: { lat: 1.33, lng: 1.67 },
  })

  it('opens the visual outdoor route picker for the selected entrance', () => {
    const onOpenOutdoorRoutePicker = vi.fn()
    mocks.component = entrance()
    render(<ComponentProperties componentId="entrance-1" onClose={vi.fn()} onOpenOutdoorRoutePicker={onOpenOutdoorRoutePicker} />)

    fireEvent.click(screen.getByRole('button', { name: 'Connect to Outdoor Route' }))

    expect(onOpenOutdoorRoutePicker).toHaveBeenCalledWith('entrance-1')
    expect(screen.queryByLabelText('Entrance outdoor node ID')).not.toBeInTheDocument()
  })

  it('assigns an entrance through readable route-point choices without a raw outdoor ID field', () => {
    mocks.component = entrance()
    render(<ComponentProperties componentId="entrance-1" onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Advanced route assignment'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Entrance indoor route node' }), { target: { value: 'route-node-1' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Entrance outdoor route point' }), { target: { value: 'outdoor-node-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign Entrance Route Access' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'entrance.access.assign',
      payload: {
        buildingId: 'building-1',
        floorId: 'floor-1',
        entranceId: 'entrance-1',
        outdoorNodeId: 'outdoor-node-7',
        indoorRouteNodeId: 'route-node-1',
      },
    }))
    expect(screen.queryByLabelText('Entrance outdoor node ID')).not.toBeInTheDocument()
  })

  it('shows an existing outdoor connection by label and keeps identifiers behind an advanced disclosure', () => {
    mocks.component = entrance()
    mocks.document.buildings[0].floors[0].entranceAccess = [{
      entranceId: 'entrance-1',
      outdoorNodeId: 'outdoor-node-7',
      indoorRouteNodeId: 'route-node-1',
    }]
    render(<ComponentProperties componentId="entrance-1" onClose={vi.fn()} />)

    expect(screen.getByText('North Campus Walk')).toBeInTheDocument()
    expect(screen.getByText('Route point 1')).toBeInTheDocument()
    expect(screen.queryByText('outdoor-node-7')).not.toBeInTheDocument()
    expect(screen.getByText('Advanced route assignment')).toBeInTheDocument()
  })
})

describe('Door properties', () => {
  const door = (): Component => ({
    id: 'door-1', type: 'door', name: 'Lab Door', buildingId: 'building-1', campusId: 'campus-1', floor: 0,
    position: { lat: 1.5, lng: 1.5 }, dimensions: { width: 1.2, height: 0.25 },
    metadata: { floorId: 'floor-1', roomId: 'room-semantic-1', ownershipStatus: 'assigned', doorType: 'standard', rotation: Math.PI / 2 },
  })

  beforeEach(() => {
    mocks.component = door()
    mocks.document.buildings[0].floors[0].doors = [{
      id: 'door-1', roomId: 'room-semantic-1', ownership: { status: 'assigned' }, name: 'Lab Door', doorType: 'standard',
      position: { x: 2, y: 3 }, width: 1.2, depth: 0.25, rotation: Math.PI / 2,
      geometry: { type: 'rectangle', min: { x: 1.4, y: 2.875 }, max: { x: 2.6, y: 3.125 }, rotation: Math.PI / 2 },
      routeConnection: { anchorNodeId: 'route-node-2', targetRouteNodeId: 'route-node-2', connectorEdgeId: 'route-edge-connector' },
      metadata: {},
    }]
  })

  it('shows ownership, geometry, type, and explicit route controls', () => {
    render(<ComponentProperties componentId="door-1" onClose={vi.fn()} />)

    expect(screen.getByLabelText('Door parent room')).toHaveValue('room-semantic-1')
    expect(screen.getByLabelText('Door width')).toHaveValue(1.2)
    expect(screen.getByLabelText('Door depth')).toHaveValue(0.25)
    expect(screen.getByLabelText('Door rotation')).toHaveValue(90)
    expect(screen.getByLabelText('Door type')).toHaveValue('standard')
    expect(screen.getByText('Assigned')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect to Route…' })).toBeDisabled()
    expect(screen.queryByRole('combobox', { name: 'Door route node' })).toBeNull()
  })

  it('lists attribute rooms without a roomId under their canonical semantic id', () => {
    mocks.document.buildings[0].floors[0].roomAttributes.push(
      { faceId: 'face-unbound', name: 'Unbound Room', searchable: true },
      { faceId: 'face-code-only', code: 'B-2', searchable: true },
      { faceId: 'face-bare', searchable: true },
    )
    render(<ComponentProperties componentId="door-1" onClose={vi.fn()} />)

    const select = screen.getByLabelText('Door parent room')
    const optionValue = (name: string) =>
      (within(select).getByRole('option', { name }) as HTMLOptionElement).value

    expect(optionValue('Unbound Room')).toBe('semantic-room-face-unbound')
    expect(optionValue('B-2')).toBe('semantic-room-face-code-only')
    expect(optionValue('semantic-room-face-bare')).toBe('semantic-room-face-bare')
  })

  it('saves Door properties and starts the route connect pick from the panel', () => {
    const onStartRouteConnect = vi.fn()
    render(<ComponentProperties componentId="door-1" onClose={vi.fn()} onStartRouteConnect={onStartRouteConnect} />)
    fireEvent.change(screen.getByLabelText('Door width'), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText('Door rotation'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'door.update',
      payload: expect.objectContaining({ doorId: 'door-1', patch: expect.objectContaining({ width: 1.5, rotation: Math.PI / 4, roomId: 'room-semantic-1' }) }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Connect to Route…' }))
    expect(onStartRouteConnect).toHaveBeenCalledWith('door-1')
    expect(screen.queryByRole('combobox', { name: 'Door route node' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'door.route.disconnect',
      payload: { doorId: 'door-1' },
    }))
  })

  it('deletes through the canonical Door command', () => {
    const onClose = vi.fn()
    render(<ComponentProperties componentId="door-1" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'door.delete', payload: { doorId: 'door-1' } }))
    expect(onClose).toHaveBeenCalled()
  })

  it('duplicates the Door through the canonical command and selects the new Door', () => {
    const onSelectComponent = vi.fn()
    mocks.execute.mockReturnValueOnce({ success: true, entityId: 'door-dup' })
    render(<ComponentProperties componentId="door-1" onClose={vi.fn()} onSelectComponent={onSelectComponent} />)

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'door.duplicate',
      label: 'Duplicate Door',
      payload: { doorId: 'door-1' },
    }))
    expect(onSelectComponent).toHaveBeenCalledWith('door-dup')
  })

  it('keeps the current selection when the duplicate command creates no Door', () => {
    const onSelectComponent = vi.fn()
    render(<ComponentProperties componentId="door-1" onClose={vi.fn()} onSelectComponent={onSelectComponent} />)

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'door.duplicate' }))
    expect(onSelectComponent).not.toHaveBeenCalled()
  })

  it('does not offer Duplicate for non-door components', () => {
    mocks.component = semanticRoom()
    render(<ComponentProperties componentId="room-semantic-1" onClose={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
  })
})

describe('vertical rectangle properties', () => {
  it('updates Stair dimensions and rotation through feature.update', () => {
    mocks.component = {
      id: 'stairs-1-0', featureId: 'stairs-1', type: 'stair', name: 'North Stair', buildingId: 'building-1', floor: 0,
      position: { lat: 1, lng: 1 }, dimensions: { width: 2, height: 3, rotation: 0 }, range: { from: 0, to: 2 }, metadata: { rotation: 0 },
    }
    mocks.document.buildings[0].staircases = [{
      id: 'stairs-1', buildingId: 'building-1', name: 'North Stair', type: 'open', accessible: false, fromLevel: 0, toLevel: 2,
      levels: { 0: { position: { x: 5, y: 6 }, rotation: 0, polygon: { points: [{ x: 4, y: 4.5 }, { x: 6, y: 4.5 }, { x: 6, y: 7.5 }, { x: 4, y: 7.5 }] } } },
    }]

    render(<ComponentProperties componentId="stairs-1-0" onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Stair width'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Stair depth'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Stair rotation'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'feature.update',
      payload: expect.objectContaining({
        featureId: 'stairs-1', level: 0,
        patch: expect.objectContaining({ position: { x: 5, y: 6 }, rotation: Math.PI / 2, polygon: { points: [{ x: 6, y: 4 }, { x: 6, y: 8 }, { x: 4, y: 8 }, { x: 4, y: 4 }] } }),
      }),
    }))
  })
})
