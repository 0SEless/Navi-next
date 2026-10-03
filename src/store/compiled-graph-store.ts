import { create } from 'zustand'
import type { NavigationGraph } from '@navi/core'
import type { NavNode as CompilerNavNode, NavEdge as CompilerNavEdge } from '@navi/core'
import type { NavNode as AStarNavNode, NavEdge as AStarNavEdge } from '@/types/nav-types'

// ── Type Conversion ──────────────────────────────────────────────
// The compiler uses @navi/core types, the A* engine uses src/types/nav-types.
// These are different types with overlapping shapes. This converter bridges them.

function mapNodeType(compilerType: CompilerNavNode['type']): AStarNavNode['type'] {
  switch (compilerType) {
    case 'space': return 'room'
    case 'corridor': return 'hallway'
    case 'transition': return 'connector_stop'
    case 'intersection': return 'intersection'
    case 'poi': return 'room'
    case 'waypoint': return 'walkway'
    case 'outdoor': return 'outdoor'
    case 'entrance': return 'building_entrance'
    default: return 'walkway'
  }
}

function mapEdgeType(compilerType: CompilerNavEdge['type']): AStarNavEdge['type'] {
  switch (compilerType) {
    case 'walk': return 'walkway'
    case 'stairs': return 'stair'
    case 'elevator': return 'elevator'
    case 'transition': return 'transition'
    default: return 'walkway'
  }
}

function mapCompilerNodeToAStar(node: CompilerNavNode, campusId: string): AStarNavNode {
  return {
    id: node.id,
    label: node.label || node.id,
    name: node.label || undefined,
    position: node.position,
    floor: node.floor,
    buildingId: node.buildingId || '',
    campusId,
    type: mapNodeType(node.type),
    hasQr: (node.properties?.hasQr as boolean) ?? false,
    hasPanorama: (node.properties?.hasPanorama as boolean) ?? false,
  }
}

function mapCompilerEdgeToAStar(edge: CompilerNavEdge, campusId: string): AStarNavEdge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    distance: edge.distance,
    weight: edge.weight,
    type: mapEdgeType(edge.type),
    campusId,
  }
}

// ── Store ────────────────────────────────────────────────────────

interface CompiledGraphState {
  /** Raw compiler result */
  result: NavigationGraph | null
  /** Converted nodes for A* engine */
  nodes: AStarNavNode[]
  /** Converted edges for A* engine */
  edges: AStarNavEdge[]
  /** Whether we're showing mock data vs real data */
  hasRealData: boolean

  /** Set the compiled graph from compiler output */
  setResult: (graph: NavigationGraph) => void
  /** Clear the compiled graph */
  clear: () => void
  /** Load from localStorage on mount */
  loadFromStorage: () => void
}

const STORAGE_KEY = 'navi-compiled-graph'

export const useCompiledGraphStore = create<CompiledGraphState>((set, get) => ({
  result: null,
  nodes: [],
  edges: [],
  hasRealData: false,

  setResult: (graph: NavigationGraph) => {
    const campusId = graph.campusId || 'campus'
    const nodes = graph.nodes.map(n => mapCompilerNodeToAStar(n, campusId))
    const edges = graph.edges.map(e => mapCompilerEdgeToAStar(e, campusId))

    set({
      result: graph,
      nodes,
      edges,
      hasRealData: nodes.length > 0,
    })

    // Persist to localStorage so Route Testing works without Studio open
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph))
    } catch {
      // localStorage full or unavailable — non-fatal
    }
  },

  clear: () => {
    set({ result: null, nodes: [], edges: [], hasRealData: false })
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // non-fatal
    }
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const graph = JSON.parse(raw) as NavigationGraph
        if (graph?.nodes?.length > 0) {
          get().setResult(graph)
        }
      }
    } catch {
      // corrupt data — ignore
    }
  },
}))
