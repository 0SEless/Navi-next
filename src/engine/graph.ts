import type {
  NavNode, NavEdge, Building, Component, DoorData, LatLng, TracePath, Area,
  GraphSnapshot, PathResult, ValidationResult, DirEntry,
} from '../types/nav-types'
import { aStar, getAdjacencyList } from './a-star'
import { haversine } from './geo-utils'
import { validateGraph } from './graph-validator'
import { buildDirectory } from './directory'
import { compileTrace } from './trace-compiler'
import { lineSegmentIntersection, closestPointOnSegment, pointToSegmentDistance } from './geo-utils'
import { genId } from './component-compiler'
import {
  CONNECTIVITY_POSITION_TOLERANCE_METERS,
  hasSeparatedCrossingAtPosition,
  SpatialQueryService,
} from '@navi/core'
import type { OutdoorPointOfInterest, SeparatedCrossing } from '@navi/core'

export class Graph {
  campusId: string = 'asu-ibajay'
  private _nodes: Map<string, NavNode> = new Map()
  private _edges: Map<string, NavEdge> = new Map()
  private _buildings: Map<string, Building> = new Map()
  private _components: Map<string, Component> = new Map()
  private _doors: DoorData[] = []
  private _traces: Map<string, TracePath> = new Map()
  private _areas: Area[] = []
  private _boundary?: { points: LatLng[] }
  /** Outdoor/campus POIs (world geometry). Indoor POIs live in Building.floorData. */
  private _pois: OutdoorPointOfInterest[] = []
  private _cachedNodes: NavNode[] | null = null
  private _cachedEdges: NavEdge[] | null = null
  private _cachedBuildings: Building[] | null = null
  private _cachedComponents: Component[] | null = null
  private _cachedTraces: TracePath[] | null = null
  private _spatialIndex: SpatialQueryService | null = null
  private _separatedCrossings: SeparatedCrossing[] = []
  /** Persisted document metadata; never used as the active compile gate. */
  private _connectivitySemanticsVersion?: string
  /** Explicit transient intent for trace intersection compilation. */
  private _allowGeometricInference = true

  // ---- Accessors ----

  get nodes(): NavNode[] {
    if (!this._cachedNodes) this._cachedNodes = Array.from(this._nodes.values())
    return this._cachedNodes
  }

  get edges(): NavEdge[] {
    if (!this._cachedEdges) this._cachedEdges = Array.from(this._edges.values())
    return this._cachedEdges
  }

  get buildings(): Building[] {
    if (!this._cachedBuildings) this._cachedBuildings = Array.from(this._buildings.values())
    return this._cachedBuildings
  }

  get components(): Component[] {
    if (!this._cachedComponents) this._cachedComponents = Array.from(this._components.values())
    return this._cachedComponents
  }

  get doors(): DoorData[] {
    return this._doors
  }

  setDoors(doors: DoorData[]): void {
    this._doors = doors
  }

  get traces(): TracePath[] {
    if (!this._cachedTraces) this._cachedTraces = Array.from(this._traces.values())
    return this._cachedTraces
  }

  get boundary(): { points: LatLng[] } | undefined {
    return this._boundary
  }

  set boundary(b: { points: LatLng[] } | undefined) {
    this._boundary = b
  }

  get areas(): Area[] {
    return this._areas
  }

  set areas(a: Area[]) {
    this._areas = a
  }

  get pois(): OutdoorPointOfInterest[] {
    return this._pois
  }

  set pois(pois: OutdoorPointOfInterest[]) {
    this._pois = pois
  }

  get separatedCrossings(): SeparatedCrossing[] {
    return this._separatedCrossings
  }

  set separatedCrossings(crossings: SeparatedCrossing[]) {
    this._separatedCrossings = crossings
  }

  setConnectivitySemanticsVersion(version?: string): void {
    this._connectivitySemanticsVersion = version
  }

  setAllowGeometricInference(allow: boolean): void {
    this._allowGeometricInference = allow
  }

  get buildingCount(): number { return this._buildings.size }
  get nodeCount(): number { return this._nodes.size }
  get edgeCount(): number { return this._edges.size }
  get componentCount(): number { return this._components.size }

  /** Compute actual connected components via BFS on the node/edge graph. */
  get connectedComponentCount(): number {
    if (this._nodes.size === 0) return 0
    const adj = new Map<string, Set<string>>()
    for (const n of this._nodes.values()) adj.set(n.id, new Set())
    for (const e of this._edges.values()) {
      adj.get(e.from)?.add(e.to)
      adj.get(e.to)?.add(e.from)
    }
    const visited = new Set<string>()
    let components = 0
    for (const n of this._nodes.values()) {
      if (visited.has(n.id)) continue
      components++
      const queue = [n.id]
      while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor)) queue.push(neighbor)
        }
      }
    }
    return components
  }

  getNode(id: string): NavNode | undefined {
    return this._nodes.get(id)
  }

  getEdge(id: string): NavEdge | undefined {
    return this._edges.get(id)
  }

  getBuilding(id: string): Building | undefined {
    return this._buildings.get(id)
  }

  getComponent(id: string): Component | undefined {
    return this._components.get(id)
  }

  // ---- Mutations ----

  addNode(node: NavNode): void {
    this._nodes.set(node.id, node)
    this._cachedNodes = null
    this._spatialIndex = null
  }

  addEdge(edge: NavEdge): void {
    this._edges.set(edge.id, edge)
    this._cachedEdges = null
  }

  removeNode(id: string): void {
    this._nodes.delete(id)
    for (const [eid, edge] of this._edges) {
      if (edge.from === id || edge.to === id) {
        this._edges.delete(eid)
      }
    }
    this._cachedNodes = null
    this._cachedEdges = null
    this._spatialIndex = null
  }

  removeEdge(id: string): void {
    this._edges.delete(id)
    this._cachedEdges = null
  }

  updateNode(id: string, partial: Partial<NavNode>): void {
    const existing = this._nodes.get(id)
    if (existing) {
      this._nodes.set(id, { ...existing, ...partial })
      this._cachedNodes = null
      this._spatialIndex = null
    }
  }

  updateEdge(id: string, partial: Partial<NavEdge>): void {
    const existing = this._edges.get(id)
    if (existing) {
      this._edges.set(id, { ...existing, ...partial })
      this._cachedEdges = null
    }
  }

  addBuilding(building: Building): void {
    this._buildings.set(building.id, building)
    this._cachedBuildings = null
  }

  updateBuilding(id: string, partial: Partial<Building>): void {
    const existing = this._buildings.get(id)
    if (existing) {
      this._buildings.set(id, { ...existing, ...partial })
      this._cachedBuildings = null
    }
  }

  removeBuilding(id: string): void {
    this._buildings.delete(id)
    for (const node of this.nodes) {
      if (node.buildingId === id) {
        this._nodes.delete(node.id)
      }
    }
    for (const [eid, edge] of this._edges) {
      if (!this._nodes.has(edge.from) || !this._nodes.has(edge.to)) {
        this._edges.delete(eid)
      }
    }
    this._cachedBuildings = null
    this._cachedNodes = null
    this._cachedEdges = null
    this._spatialIndex = null
  }

  // ---- Component Operations ----

  addComponent(component: Component): void {
    this._components.set(component.id, component)
    this._cachedComponents = null
  }

  updateComponent(id: string, partial: Partial<Component>): void {
    const existing = this._components.get(id)
    if (existing) {
      this._components.set(id, { ...existing, ...partial })
      this._cachedComponents = null
    }
  }

  removeComponent(id: string): void {
    this._components.delete(id)
    for (const node of this.nodes) {
      if (node.componentId === id) {
        this._nodes.delete(node.id)
      }
    }
    for (const [eid, edge] of this._edges) {
      if (!this._nodes.has(edge.from) || !this._nodes.has(edge.to)) {
        this._edges.delete(eid)
      }
    }
    this._cachedComponents = null
    this._cachedNodes = null
    this._cachedEdges = null
    this._spatialIndex = null
  }

  getNodesByComponent(componentId: string): NavNode[] {
    return this.nodes.filter((n) => n.componentId === componentId)
  }

  // ---- Trace Operations ----

  getTrace(id: string): TracePath | undefined {
    return this._traces.get(id)
  }

  addTrace(trace: TracePath): void {
    this._traces.set(trace.id, trace)
    this._cachedTraces = null
  }

  updateTrace(id: string, partial: Partial<TracePath>): void {
    const existing = this._traces.get(id)
    if (existing) {
      this._traces.set(id, { ...existing, ...partial })
      this._cachedTraces = null
    }
  }

  removeTrace(id: string): void {
    this._traces.delete(id)
    const nodesToDelete: string[] = []

    for (const [nid, node] of this._nodes) {
      const meta = node.metadata as Record<string, unknown> | undefined
      if (!meta) continue

      const metaTraceId = meta.traceId as string | undefined
      const metaTraceIds = meta.traceIds as string[] | undefined

      if (metaTraceIds?.includes(id)) {
        // Shared intersection node — remove this trace's ID
        const remaining = metaTraceIds.filter(tid => tid !== id)
        if (remaining.length > 0) {
          node.metadata = { ...meta, traceIds: remaining }
        } else {
          nodesToDelete.push(nid)
        }
      } else if (metaTraceId === id && !metaTraceIds?.length) {
        // Fully owned node (only has traceId, no traceIds array)
        nodesToDelete.push(nid)
      }
    }

    for (const nid of nodesToDelete) {
      this._nodes.delete(nid)
    }

    // Cleanup: remove stale traceId from surviving nodes
    for (const [, node] of this._nodes) {
      const meta = node.metadata as Record<string, unknown> | undefined
      if (meta && (meta.traceId as string) === id && (meta.traceIds as string[] | undefined)?.length) {
        const { traceId: _, ...rest } = meta
        node.metadata = rest
      }
    }

    for (const [eid, edge] of this._edges) {
      if (!this._nodes.has(edge.from) || !this._nodes.has(edge.to)) {
        this._edges.delete(eid)
      }
    }

    this._cachedTraces = null
    this._cachedNodes = null
    this._cachedEdges = null
  }

  addTraceWithCompile(
    trace: TracePath,
    roomNodesOrConnectivityRadius: NavNode[] | number = [],
    allowGeometricInference = this._allowGeometricInference,
    stableReference?: { nodes?: NavNode[]; edges?: NavEdge[] },
  ): void {
    // Preserve the pre-Phase-6 array call shape while allowing the editor
    // adapter to pass an explicit connectivity radius. The current
    // trace-compiler intentionally does not create room-door edges; accepting
    // the old array form avoids breaking the store caller without reviving
    // that bypass path.
    const connectivityRadius = typeof roomNodesOrConnectivityRadius === 'number'
      ? roomNodesOrConnectivityRadius
      : undefined
    const result = compileTrace(
      trace,
      this.nodes,
      this.edges,
      stableReference,
    )
    this.addTrace(trace)
    for (const node of result.nodes) {
      node.metadata = { ...node.metadata, traceId: trace.id }
      this.addNode(node)
    }
    for (const edge of result.edges) {
      this.addEdge(edge)
    }
    this.syncTraceIntersections(trace.id, connectivityRadius, allowGeometricInference)
  }

  recompileTrace(id: string, allowGeometricInference = this._allowGeometricInference): void {
    const trace = this._traces.get(id)
    if (!trace) return

    // 1. Collect old nodes for this trace, handling shared intersection nodes
    const fullyOwned: string[] = []
    const sharedNodes: { nodeId: string; traceIds: string[] }[] = []
    for (const [nid, node] of this._nodes) {
      const meta = node.metadata as Record<string, unknown> | undefined
      const metaTraceId = meta?.traceId as string | undefined
      const metaTraceIds = meta?.traceIds as string[] | undefined
      if (metaTraceId === id && (!metaTraceIds || metaTraceIds.length <= 1)) {
        // Fully owned by this trace (single traceId or just traceId field)
        fullyOwned.push(nid)
      } else if (metaTraceIds?.includes(id)) {
        // Shared intersection node — remove this trace's ID
        sharedNodes.push({ nodeId: nid, traceIds: metaTraceIds.filter(tid => tid !== id) })
      }
    }

    // 2. Update shared nodes: remove this trace's ID
    for (const { nodeId, traceIds } of sharedNodes) {
      const node = this._nodes.get(nodeId)!
      if (traceIds.length > 0) {
        node.metadata = { ...node.metadata, traceIds }
      } else {
        // No other traces reference it — delete
        fullyOwned.push(nodeId)
      }
    }

    // 3. Remove fully owned nodes
    for (const nid of fullyOwned) {
      this._nodes.delete(nid)
    }

    // 4. Remove orphaned edges
    for (const [eid, edge] of this._edges) {
      if (!this._nodes.has(edge.from) || !this._nodes.has(edge.to)) {
        this._edges.delete(eid)
      }
    }

    // 5. Recompile with updated trace points
    const result = compileTrace(trace, this.nodes, this.edges)
    for (const node of result.nodes) {
      node.metadata = { ...node.metadata, traceId: trace.id }
      this.addNode(node)
    }
    for (const edge of result.edges) {
      this.addEdge(edge)
    }

    // 6. Re-run intersection detection against other routes
    this.syncTraceIntersections(id, undefined, allowGeometricInference)

    // 7. Invalidate all caches
    this._cachedTraces = null
    this._cachedNodes = null
    this._cachedEdges = null
  }

  connectNodes(idA: string, idB: string): NavEdge | null {
    const nodeA = this._nodes.get(idA)
    const nodeB = this._nodes.get(idB)
    if (!nodeA || !nodeB) return null
    const edgeExists = this.edges.some(
      (e) => (e.from === idA && e.to === idB) || (e.from === idB && e.to === idA)
    )
    if (edgeExists) return null
    const d = haversine(nodeA.position, nodeB.position)
    const edge: NavEdge = {
      id: genId('E'), from: idA, to: idB,
      type: 'walk', distance: d, weight: d,
      campusId: nodeA.campusId,
    }
    this.addEdge(edge)
    return edge
  }

  splitEdge(edgeId: string, position: LatLng): NavNode | null {
    const edge = this._edges.get(edgeId)
    if (!edge) return null
    const id = genId('N')
    const fromPos = this._nodePosition(edge.from)
    const toPos = this._nodePosition(edge.to)
    const d1 = haversine(position, fromPos)
    const d2 = haversine(position, toPos)
    const node: NavNode = {
      id, label: 'Connection', name: 'Connection',
      type: 'intersection',
      buildingId: this._nodes.get(edge.from)?.buildingId ?? '',
      campusId: edge.campusId ?? '',
      floor: this._nodes.get(edge.from)?.floor ?? 0,
      position,
      metadata: { connectionNode: true, traceId: this._nodes.get(edge.from)?.metadata?.traceId },
    }
    this.removeEdge(edgeId)
    this.addNode(node)
    this.addEdge({
      id: genId('E'), from: edge.from, to: id,
      type: edge.type, distance: d1, weight: d1, campusId: edge.campusId,
    })
    this.addEdge({
      id: genId('E'), from: id, to: edge.to,
      type: edge.type, distance: d2, weight: d2, campusId: edge.campusId,
    })
    return node
  }

  /**
   * Split an authored trace edge using a caller-owned, stable node identity.
   * The node is supplied by the explicit access projection; unlike splitEdge,
   * this method never invents the persisted node ID from a generated counter.
   */
  splitEdgeWithNode(edgeId: string, node: NavNode): NavNode | null {
    const edge = this._edges.get(edgeId)
    if (!edge) return null
    const existing = this._nodes.get(node.id)
    if (existing && (edge.from === existing.id || edge.to === existing.id)) return existing

    const fromPos = this._nodePosition(edge.from)
    const toPos = this._nodePosition(edge.to)
    const splitNode = existing ?? node
    const d1 = haversine(splitNode.position, fromPos)
    const d2 = haversine(splitNode.position, toPos)
    this.removeEdge(edgeId)
    if (!existing) this.addNode(node)
    this.addEdge({ ...edge, id: genId('E'), from: edge.from, to: splitNode.id, distance: d1, weight: d1 })
    this.addEdge({ ...edge, id: genId('E'), from: splitNode.id, to: edge.to, distance: d2, weight: d2 })
    return splitNode
  }

  setTraces(traces: TracePath[]): void {
    this._traces.clear()
    for (const t of traces) this._traces.set(t.id, t)
    this._cachedTraces = null
  }

  // ---- Bulk Operations ----

  setNodes(nodes: NavNode[]): void {
    this._nodes.clear()
    for (const n of nodes) this._nodes.set(n.id, n)
    this._cachedNodes = null
    this._spatialIndex = null
  }

  setEdges(edges: NavEdge[]): void {
    this._edges.clear()
    for (const e of edges) this._edges.set(e.id, e)
    this._cachedEdges = null
  }

  setBuildings(buildings: Building[]): void {
    this._buildings.clear()
    for (const b of buildings) this._buildings.set(b.id, b)
    this._cachedBuildings = null
  }

  setComponents(components: Component[]): void {
    this._components.clear()
    for (const c of components) this._components.set(c.id, c)
    this._cachedComponents = null
  }

  // ---- Queries ----

  findPath(fromId: string, toId: string): PathResult | null {
    return aStar(this.nodes, this.edges, fromId, toId, {
      buildings: this.buildings,
      components: this.components,
    })
  }

  getNodesByBuilding(buildingId: string): NavNode[] {
    return this.nodes.filter((n) => n.buildingId === buildingId)
  }

  getNodesByFloor(buildingId: string, floor: number): NavNode[] {
    return this.nodes.filter((n) => n.buildingId === buildingId && n.floor === floor)
  }

  getEdgesForNode(nodeId: string): NavEdge[] {
    return this.edges.filter((e) => e.from === nodeId || e.to === nodeId)
  }

  private _buildSpatialIndex(): SpatialQueryService {
    if (!this._spatialIndex) {
      this._spatialIndex = new SpatialQueryService()
      this._spatialIndex.loadFromNodes(this.nodes as unknown as Array<{ id: string; position: LatLng; type?: string; floor?: number; buildingId?: string; [key: string]: unknown }>)
    }
    return this._spatialIndex
  }

  getNearestNode(position: LatLng, maxDistance = 50): NavNode | null {
    const index = this._buildSpatialIndex()
    const result = index.nearestEntity(position, { maxDistance })
    if (!result) return null
    return this._nodes.get(result.entity.id) ?? null
  }

  syncHallwayIntersections(buildingId: string, floor: number): void {
    const hallways = this.components.filter(
      c => c.type === 'hallway' && c.buildingId === buildingId && c.floor === floor
    )
    if (hallways.length < 2) return

    interface HallwayData { nodes: NavNode[]; edges: NavEdge[] }
    const data: HallwayData[] = []

    for (const hw of hallways) {
      if (!hw.polygon || hw.polygon.length < 2) continue
      const hwNodes = hw.polygon.map(pos =>
        this.nodes.find(n => n.componentId === hw.id && n.position.lat === pos.lat && n.position.lng === pos.lng)
      ).filter((n): n is NavNode => n !== undefined)
      const hwEdges: NavEdge[] = []
      for (let i = 0; i < hwNodes.length - 1; i++) {
        const e = this.edges.find(edge =>
          (edge.from === hwNodes[i].id && edge.to === hwNodes[i + 1].id) ||
          (edge.to === hwNodes[i].id && edge.from === hwNodes[i + 1].id)
        )
        if (e) hwEdges.push(e)
      }
      if (hwEdges.length > 0) data.push({ nodes: hwNodes, edges: hwEdges })
    }

    const TARGET_THRESHOLD = 5
    const SAME_POS = CONNECTIVITY_POSITION_TOLERANCE_METERS

    const edgeExists = (a: string, b: string) =>
      this.edges.some(e => (e.from === a && e.to === b) || (e.from === b && e.to === a))

    const splitEdge = (edge: NavEdge, p1: LatLng, p2: LatLng, newNodeId: string) => {
      this.removeEdge(edge.id)
      const d1 = haversine(p1, this._nodePosition(edge.from))
      const d2 = haversine(this._nodePosition(edge.to), p2)
      this.addEdge({ ...edge, id: genId('E'), from: edge.from, to: newNodeId, distance: d1, weight: d1 })
      this.addEdge({ ...edge, id: genId('E'), from: newNodeId, to: edge.to, distance: d2, weight: d2 })
    }

    for (let ai = 0; ai < data.length; ai++) {
      for (let bi = ai + 1; bi < data.length; bi++) {
        const a = data[ai]
        const b = data[bi]

        for (let si = 0; si < a.nodes.length - 1; si++) {
          for (let sj = 0; sj < b.nodes.length - 1; sj++) {
            const p1 = a.nodes[si].position
            const p2 = a.nodes[si + 1].position
            const p3 = b.nodes[sj].position
            const p4 = b.nodes[sj + 1].position

            const intersection = lineSegmentIntersection(p1, p2, p3, p4)
            if (!intersection) continue
            if (this._buildSpatialIndex().nearestEntity(intersection, { maxDistance: SAME_POS })) continue

            const newNode: NavNode = {
              id: genId('N'),
              label: `X: ${intersection.lat.toFixed(5)}, ${intersection.lng.toFixed(5)}`,
              name: 'Intersection',
              type: 'intersection',
              buildingId,
              campusId: this.campusId,
              floor,
              position: intersection,
            }
            this.addNode(newNode)

            const edgeA = this._edges.get(a.edges[si]?.id)
            if (edgeA) splitEdge(edgeA, p1, p2, newNode.id)
            const edgeB = this._edges.get(b.edges[sj]?.id)
            if (edgeB) splitEdge(edgeB, p3, p4, newNode.id)
          }
        }

        const connectEndpoint = (ep: NavNode, targetNodes: NavNode[], targetEdges: NavEdge[]) => {
          for (let sj = 0; sj < targetNodes.length - 1; sj++) {
            const d = pointToSegmentDistance(
              ep.position, targetNodes[sj].position, targetNodes[sj + 1].position
            )
            if (d > TARGET_THRESHOLD) continue

            const closest = closestPointOnSegment(
              ep.position, targetNodes[sj].position, targetNodes[sj + 1].position
            )
            const nearResult = this._buildSpatialIndex().nearestEntity(closest, { maxDistance: SAME_POS, type: 'intersection' })
            const near = nearResult ? this._nodes.get(nearResult.entity.id) ?? null : null

            if (near) {
              if (!edgeExists(ep.id, near.id)) {
                const dist = haversine(ep.position, near.position)
                this.addEdge({ id: genId('E'), from: ep.id, to: near.id, type: 'corridor', distance: dist, weight: dist, campusId: this.campusId })
              }
              return
            }

            if (d < SAME_POS) return

            const newNode: NavNode = {
              id: genId('N'),
              label: `TJ: ${closest.lat.toFixed(5)}, ${closest.lng.toFixed(5)}`,
              name: 'Intersection',
              type: 'intersection',
              buildingId,
              campusId: this.campusId,
              floor,
              position: closest,
            }
            this.addNode(newNode)

            const edgeB = this._edges.get(targetEdges[sj]?.id)
            if (edgeB) {
              splitEdge(edgeB, targetNodes[sj].position, targetNodes[sj + 1].position, newNode.id)
            }

            const dist = haversine(ep.position, closest)
            this.addEdge({ id: genId('E'), from: ep.id, to: newNode.id, type: 'corridor', distance: dist, weight: dist, campusId: this.campusId })
            return
          }
        }

        const aEndpoints = [a.nodes[0], a.nodes[a.nodes.length - 1]].filter(Boolean)
        const bEndpoints = [b.nodes[0], b.nodes[b.nodes.length - 1]].filter(Boolean)

        for (const ep of aEndpoints) connectEndpoint(ep, b.nodes, b.edges)
        for (const ep of bEndpoints) connectEndpoint(ep, a.nodes, a.edges)
      }
    }
  }

  syncTraceIntersections(
    traceId: string,
    connectivityRadius = 5,
    allowGeometricInference = this._allowGeometricInference,
  ): void {
    const trace = this._traces.get(traceId)
    if (!trace || trace.points.length < 2) return

    const TARGET_THRESHOLD = connectivityRadius
    const SAME_POS = 0.5

    const edgeExists = (a: string, b: string) =>
      this.edges.some(e => (e.from === a && e.to === b) || (e.from === b && e.to === a))

    type ProjectedNode = {
      node: NavNode
      distance: number
      along: number
      segmentIndex: number
    }
    type TraceChain = {
      traceId: string
      nodes: NavNode[]
      edges: (NavEdge | undefined)[]
    }

    const traceIdsForNode = (node: NavNode): string[] => {
      const metadata = node.metadata
      return [...new Set([
        ...(typeof metadata?.traceId === 'string' ? [metadata.traceId] : []),
        ...(Array.isArray(metadata?.traceIds)
          ? metadata.traceIds.filter((id): id is string => typeof id === 'string')
          : []),
      ])]
    }

    const projectNode = (node: NavNode, points: LatLng[]): ProjectedNode | null => {
      if (points.length < 2) return null

      let cumulative = 0
      let best: ProjectedNode | null = null
      for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]
        const end = points[i + 1]
        const closest = closestPointOnSegment(node.position, start, end)
        const distance = haversine(node.position, closest)
        const segmentLength = haversine(start, end)
        const along = cumulative + haversine(start, closest)
        if (!best || distance < best.distance) {
          best = { node, distance, along, segmentIndex: i }
        }
        cumulative += segmentLength
      }
      return best
    }

    const buildTraceChain = (targetTrace: TracePath): TraceChain | null => {
      const authoredNodes: NavNode[] = []
      for (const point of targetTrace.points) {
        const node = this.nodes.find(n =>
          n.metadata?.traceId === targetTrace.id &&
          Math.abs(n.position.lat - point.lat) < 0.00001 &&
          Math.abs(n.position.lng - point.lng) < 0.00001
        )
        if (node && !authoredNodes.some(existing => existing.id === node.id)) {
          authoredNodes.push(node)
        }
      }
      if (authoredNodes.length < 2) return null

      const authoredNodeIds = new Set(authoredNodes.map(node => node.id))
      const sharedNodes: ProjectedNode[] = []
      for (const node of this.nodes) {
        if (authoredNodeIds.has(node.id)) continue
        const metadata = node.metadata
        if (!Array.isArray(metadata?.traceIds) || !traceIdsForNode(node).includes(targetTrace.id)) continue

        const projected = projectNode(node, targetTrace.points)
        if (!projected || projected.distance > TARGET_THRESHOLD) continue

        const samePositionNode = authoredNodes.find(authored =>
          haversine(authored.position, node.position) <= SAME_POS
        )
        if (samePositionNode) {
          if (!edgeExists(samePositionNode.id, node.id)) {
            const distance = haversine(samePositionNode.position, node.position)
            this.addEdge({
              id: genId('E'),
              from: samePositionNode.id,
              to: node.id,
              type: 'walk',
              distance,
              weight: distance,
              campusId: targetTrace.campusId ?? this.campusId,
            })
          }
          continue
        }

        sharedNodes.push(projected)
      }

      // Split authored edges in order along each polyline segment. This uses
      // the persisted node itself, so no singular traceId is assigned to a
      // junction shared by multiple roads.
      for (let segmentIndex = 0; segmentIndex < authoredNodes.length - 1; segmentIndex++) {
        const segmentJunctions = sharedNodes
          .filter(projected => projected.segmentIndex === segmentIndex)
          .sort((left, right) => left.along - right.along || left.node.id.localeCompare(right.node.id))

        let leftNode = authoredNodes[segmentIndex]
        const rightNode = authoredNodes[segmentIndex + 1]
        for (const projected of segmentJunctions) {
          const edge = this.edges.find(candidate =>
            (candidate.from === leftNode.id && candidate.to === rightNode.id) ||
            (candidate.from === rightNode.id && candidate.to === leftNode.id)
          )
          if (edge && edge.from !== projected.node.id && edge.to !== projected.node.id) {
            this.splitEdgeWithNode(edge.id, projected.node)
          }
          leftNode = projected.node
        }
      }

      const ordered = [
        ...authoredNodes.map(node => projectNode(node, targetTrace.points)).filter((node): node is ProjectedNode => node !== null),
        ...sharedNodes,
      ].sort((left, right) => left.along - right.along || left.node.id.localeCompare(right.node.id))

      const nodes: NavNode[] = []
      for (const projected of ordered) {
        if (!nodes.some(existing => existing.id === projected.node.id)) nodes.push(projected.node)
      }

      const edges: (NavEdge | undefined)[] = []
      for (let i = 0; i < nodes.length - 1; i++) {
        edges[i] = this.edges.find(edge =>
          (edge.from === nodes[i].id && edge.to === nodes[i + 1].id) ||
          (edge.from === nodes[i + 1].id && edge.to === nodes[i].id)
        )
      }
      return { traceId: targetTrace.id, nodes, edges }
    }

    // Prepare the newly compiled trace too. A persisted junction may be
    // interior to this trace, in which case Phase 2 must see both sides of
    // its already-split edge and must not create a duplicate junction.
    const newChain = buildTraceChain(trace)
    if (!newChain || newChain.nodes.length < 2) return
    const newNodes = newChain.nodes
    const newNodeIds = newNodes
      .filter(node => node.metadata?.traceId === traceId)
      .map(node => node.id)

    // Get existing traces (excluding the one being added/recompiled).
    const existingTraces = this.traces.filter(t => t.id !== traceId && t.points.length >= 2)
    if (existingTraces.length === 0) return

    // Build ordered node+edge chains for existing traces. Shared junctions
    // participate through plural traceIds and are sorted by polyline position.
    const chains: TraceChain[] = []
    for (const existingTrace of existingTraces) {
      const chain = buildTraceChain(existingTrace)
      if (chain && chain.edges.some(Boolean)) chains.push(chain)
    }
    if (chains.length === 0) return

    // Persisted/shared junction nodes were incorporated by buildTraceChain
    // above. Everything below this point derives topology from geometry, so
    // explicit-only compilation must stop here.
    if (!allowGeometricInference) return

    // ---- Phase 1: Endpoint T-junctions ----
    const endpoints = [newNodes[0], newNodes[newNodes.length - 1]]
    for (const ep of endpoints) {
      for (const chain of chains) {
        for (let sj = 0; sj < chain.nodes.length - 1; sj++) {
          const d = pointToSegmentDistance(
            ep.position, chain.nodes[sj].position, chain.nodes[sj + 1].position
          )
          if (d > TARGET_THRESHOLD) continue

          const closest = closestPointOnSegment(
            ep.position, chain.nodes[sj].position, chain.nodes[sj + 1].position
          )

          // Snap trace endpoint to the closest point (trim excess).
          // Do NOT mutate trace.points — authored geometry is canonical.
          ep.position = { ...closest }

          // Check for existing node at the closest point
          const nearResult = this._buildSpatialIndex().nearestEntity(closest, {
            maxDistance: SAME_POS,
            type: 'intersection',
            exclude: newNodeIds,
          })
          const near = nearResult ? this._nodes.get(nearResult.entity.id) ?? null : null

          let intersectionNode: NavNode
          if (near) {
            intersectionNode = near
            const meta = near.metadata || {}
            const existingIds = (meta.traceIds as string[]) || (meta.traceId ? [meta.traceId as string] : [])
            const ids = [...new Set([...existingIds, traceId, chain.traceId])]
            near.metadata = { ...meta, traceIds: ids, connectionNode: true }
          } else {
            // The endpoint is already the canonical node for the new trace.
            // Reuse it as the junction so the resolver cannot create a
            // zero-length self-loop from the endpoint to a duplicate node.
            const targetEdge = chain.edges[sj]
            if (!targetEdge) continue
            const edgeFrom = targetEdge.from
            const edgeTo = targetEdge.to
            const edgeType = targetEdge.type
            const edgeCampusId = targetEdge.campusId

            intersectionNode = ep
            const meta = ep.metadata || {}
            const existingIds = (meta.traceIds as string[]) || (meta.traceId ? [meta.traceId as string] : [])
            const ids = [...new Set([...existingIds, traceId, chain.traceId])]
            ep.metadata = { ...meta, traceIds: ids, connectionNode: true }
            this.removeEdge(targetEdge.id)
            this.addEdge({
              id: genId('E'), from: edgeFrom, to: ep.id,
              type: edgeType,
              distance: haversine(this._nodePosition(edgeFrom), closest),
              weight: haversine(this._nodePosition(edgeFrom), closest),
              campusId: edgeCampusId ?? '',
            })
            this.addEdge({
              id: genId('E'), from: ep.id, to: edgeTo,
              type: edgeType,
              distance: haversine(closest, this._nodePosition(edgeTo)),
              weight: haversine(closest, this._nodePosition(edgeTo)),
              campusId: edgeCampusId ?? '',
            })
          }

          // Connect the new trace's endpoint node to the intersection node
          if (ep.id !== intersectionNode.id && !edgeExists(ep.id, intersectionNode.id)) {
            const dist = haversine(ep.position, intersectionNode.position)
            this.addEdge({
              id: genId('E'), from: ep.id, to: intersectionNode.id,
              type: 'walk', distance: dist, weight: dist,
              campusId: trace.campusId ?? '',
            })
          }

          // Rebuild this chain's edge references after the split, so
          // subsequent endpoints see the updated edge topology.
          for (let i = 0; i < chain.nodes.length - 1; i++) {
            chain.edges[i] = this.edges.find(edge =>
              (edge.from === chain.nodes[i].id && edge.to === chain.nodes[i + 1].id) ||
              (edge.from === chain.nodes[i + 1].id && edge.to === chain.nodes[i].id)
            )
          }

          break // only one connection per endpoint
        }
      }
    }

    // ---- Phase 2: Crossings (X-intersections) ----
    // In modern canonical mode (connectivitySemanticsVersion present), geometry
    // alone does NOT create connectivity. Only explicit authored junctions
    // create connections. Skip geometric crossing detection.
    for (let si = 0; si < newNodes.length - 1; si++) {
      for (const chain of chains) {
        for (let sj = 0; sj < chain.nodes.length - 1; sj++) {
          const intersection = lineSegmentIntersection(
            newNodes[si].position, newNodes[si + 1].position,
            chain.nodes[sj].position, chain.nodes[sj + 1].position
          )
          if (!intersection) continue

          // Skip only this crossing position. A separated P1 must not suppress
          // a geometric P2 junction for the same road pair.
          if (hasSeparatedCrossingAtPosition(
            this._separatedCrossings,
            traceId,
            chain.traceId,
            intersection,
          )) continue

          if (this._buildSpatialIndex().nearestEntity(intersection, {
            maxDistance: SAME_POS,
            exclude: newNodeIds,
          })) continue

          const newEdge = this.edges.find(edge =>
            (edge.from === newNodes[si].id && edge.to === newNodes[si + 1].id) ||
            (edge.from === newNodes[si + 1].id && edge.to === newNodes[si].id)
          )
          if (!newEdge) continue

          // Capture edge info before splitting. A segment without a direct
          // edge is already represented by a split/shared junction and must
          // not be dereferenced or guessed at.
          const targetEdge = chain.edges[sj]
          if (!targetEdge) continue
          const edgeId = targetEdge.id
          const edgeFrom = targetEdge.from
          const edgeTo = targetEdge.to
          const edgeType = targetEdge.type
          const edgeCampusId = targetEdge.campusId
          const newEdgeFrom = newEdge.from
          const newEdgeTo = newEdge.to
          const newEdgeType = newEdge.type
          const newEdgeCampusId = newEdge.campusId

          const id = genId('N')
          const buildingId = trace.buildingId ?? chain.nodes[sj].buildingId
          const intersectionNode: NavNode = {
            id, label: 'Route Junction', name: 'Route Junction',
            type: 'intersection',
            campusId: trace.campusId ?? '',
            floor: trace.floor,
            buildingId,
            position: intersection,
            metadata: { traceIds: [chain.traceId, traceId], connectionNode: true },
          }
          this.removeEdge(edgeId)
          this.addNode(intersectionNode)
          this.addEdge({
            id: genId('E'), from: edgeFrom, to: id,
            type: edgeType,
            distance: haversine(this._nodePosition(edgeFrom), intersection),
            weight: haversine(this._nodePosition(edgeFrom), intersection),
            campusId: edgeCampusId ?? '',
          })
          this.addEdge({
            id: genId('E'), from: id, to: edgeTo,
            type: edgeType,
            distance: haversine(intersection, this._nodePosition(edgeTo)),
            weight: haversine(intersection, this._nodePosition(edgeTo)),
            campusId: edgeCampusId ?? '',
          })

          // Split the new trace too. Connecting only its closer endpoint
          // leaves the junction attached to one side of the crossing.
          this.removeEdge(newEdge.id)
          this.addEdge({
            id: genId('E'), from: newEdgeFrom, to: id,
            type: newEdgeType,
            distance: haversine(this._nodePosition(newEdgeFrom), intersection),
            weight: haversine(this._nodePosition(newEdgeFrom), intersection),
            campusId: newEdgeCampusId ?? '',
          })
          this.addEdge({
            id: genId('E'), from: id, to: newEdgeTo,
            type: newEdgeType,
            distance: haversine(intersection, this._nodePosition(newEdgeTo)),
            weight: haversine(intersection, this._nodePosition(newEdgeTo)),
            campusId: newEdgeCampusId ?? '',
          })
    }
    }
    } // end canonical mode guard — Phase 2 skipped when version marker present

    this._cachedNodes = null
    this._cachedEdges = null
    this._cachedTraces = null
  }

  getAdjacencyList(): Record<string, { nodeId: string; weight: number }[]> {
    return getAdjacencyList(this.edges)
  }

  // ---- Derived Views ----

  getDirectory(): DirEntry[] {
    return buildDirectory(this)
  }

  validate(): ValidationResult[] {
    return validateGraph(this.nodes, this.edges, this.buildings)
  }

  // ---- Serialization ----

  toJSON(): GraphSnapshot {
    return {
      id: this.campusId || 'unknown',
      version: '1.0.0',
      campusId: this.campusId || 'asu-ibajay',
      updatedAt: new Date().toISOString(),
      buildings: this.buildings,
      nodes: this.nodes,
      edges: this.edges,
      components: this.components,
      traces: this.traces,
      areas: this.areas,
      ...(this._pois.length > 0 ? { pois: this._pois } : {}),
      boundary: this._boundary,
      doors: this._doors.length > 0 ? this._doors : undefined,
      separatedCrossings: this._separatedCrossings.length > 0 ? this._separatedCrossings : undefined,
      connectivitySemanticsVersion: this._connectivitySemanticsVersion,
    }
  }

  static fromJSON(snapshot: GraphSnapshot): Graph {
    const graph = new Graph()
    graph.campusId = snapshot.campusId || 'asu-ibajay'
    graph.setBuildings(snapshot.buildings)
    graph.setNodes(snapshot.nodes)
    graph.setEdges(snapshot.edges)
    graph.setComponents(snapshot.components ?? [])
    if (snapshot.traces) graph.setTraces(snapshot.traces)
    if (snapshot.areas) graph.areas = snapshot.areas
    if (snapshot.pois) graph.pois = snapshot.pois
    if (snapshot.boundary) graph._boundary = snapshot.boundary
    if (snapshot.doors) graph._doors = snapshot.doors
    if (snapshot.separatedCrossings) graph._separatedCrossings = snapshot.separatedCrossings
    if (snapshot.connectivitySemanticsVersion) {
      graph._connectivitySemanticsVersion = snapshot.connectivitySemanticsVersion
      graph._allowGeometricInference = false
    }
    return graph
  }

  // ---- Helpers ----

  private _nodePosition(nodeId: string): LatLng {
    return this._nodes.get(nodeId)?.position ?? { lat: 0, lng: 0 }
  }
}
