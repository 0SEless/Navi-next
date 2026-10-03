import type { NavNode, NavEdge, LatLng, PathResult, PathStep, Building, Component } from '../types/nav-types'
import { haversine } from './geo-utils'

function buildAdjacencyList(edges: NavEdge[]): Record<string, { nodeId: string; weight: number }[]> {
  const adj: Record<string, { nodeId: string; weight: number }[]> = {}
  for (const e of edges) {
    if (!adj[e.from]) adj[e.from] = []
    if (!adj[e.to]) adj[e.to] = []
    adj[e.from].push({ nodeId: e.to, weight: e.distance })
    adj[e.to].push({ nodeId: e.from, weight: e.distance })
  }
  return adj
}

function heuristic(a: LatLng, b: LatLng): number {
  return haversine(a, b)
}

const FLOOR_LABELS = ['GF', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', 'B1', 'B2', 'B3']

function floorLabel(level: number): string {
  return FLOOR_LABELS[level] ?? `${level}F`
}

function nodeDisplayName(node: NavNode, buildings: Map<string, Building>, components: Map<string, Component>): string {
  if (node.name) return node.name

  if (node.componentId) {
    const comp = components.get(node.componentId)
    if (comp?.name) return comp.name
  }

  if (node.type === 'building_entrance') {
    const bldg = buildings.get(node.buildingId)
    const base = bldg ? `${bldg.name}` : 'Building'
    return `${base} Entrance`
  }

  if (node.type === 'room' || node.type === 'room_door') return `Room ${node.label}`
  if (node.type === 'stair' || node.type === 'staircase') return `Stairs to ${floorLabel(node.floor)}`
  if (node.type === 'elevator') return `Elevator to ${floorLabel(node.floor)}`
  if (node.type === 'hallway') return `Hallway`

  return node.label || node.id.slice(0, 8)
}

function getBearing(from: LatLng, to: LatLng): number {
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180) / Math.PI
}

function generateInstructions(
  path: string[],
  nodes: NavNode[],
  edges: NavEdge[],
  buildings?: Building[],
  components?: Component[],
): PathStep[] {
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const buildingMap = new Map(buildings?.map((b) => [b.id, b]) ?? [])
  const componentMap = new Map(components?.map((c) => [c.id, c]) ?? [])

  const degreeMap: Record<string, number> = {}
  for (const e of edges) {
    degreeMap[e.from] = (degreeMap[e.from] ?? 0) + 1
    degreeMap[e.to] = (degreeMap[e.to] ?? 0) + 1
  }

  function getTurnInstruction(prev: NavNode, curr: NavNode, next: NavNode): string {
    const bearingIn = getBearing(prev.position, curr.position)
    const bearingOut = getBearing(curr.position, next.position)
    let delta = bearingOut - bearingIn
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360

    const nextComp = next.componentId ? componentMap.get(next.componentId) : undefined
    const targetName = nextComp?.name ?? next.name ?? 'hallway'

    if (delta > 30) return `Turn right onto ${targetName}`
    if (delta < -30) return `Turn left onto ${targetName}`
    return `Continue straight along ${targetName}`
  }

  return path.flatMap((nodeId, i) => {
    const node = nodeMap[nodeId]
    if (!node) return []
    const prev = i > 0 ? nodeMap[path[i - 1]] : null
    const next = i < path.length - 1 ? nodeMap[path[i + 1]] : null
    const dist = prev ? Math.round(haversine(prev.position, node.position)) : 0
    const bldg = buildingMap.get(node.buildingId)
    const buildingName = bldg?.name ?? ''

    let instruction = ''

    if (i === 0) {
      const parts = ['Start here']
      if (buildingName) parts.push(`at ${buildingName}`)
      parts.push(`(${floorLabel(node.floor)})`)
      instruction = parts.join(' ')
    } else if (i === path.length - 1) {
      const parts = ['Destination reached']
      if (buildingName) parts.push(`at ${buildingName}`)
      const display = nodeDisplayName(node, buildingMap, componentMap)
      if (display && display !== buildingName) parts.push(`— ${display}`)
      parts.push(`(${floorLabel(node.floor)})`)
      instruction = parts.join(' ')
    } else {
      const display = nodeDisplayName(node, buildingMap, componentMap)
      // Floor transition
      if (prev && node.floor !== prev.floor) {
        const dir = node.floor > prev.floor ? 'up' : 'down'
        const via = node.type === 'stair' || node.type === 'staircase' ? 'stairs' :
                     node.type === 'elevator' ? 'elevator' : 'walk'
        instruction = `Take ${via} ${dir} to ${floorLabel(node.floor)}`
        if (buildingName && buildingName !== (buildingMap.get(prev.buildingId)?.name ?? '')) {
          instruction += ` in ${buildingName}`
        }
      }
      // Crossing into a building
      else if (prev && prev.buildingId !== node.buildingId) {
        instruction = `Enter ${buildingName || node.buildingId.slice(0, 8)}`
        if (node.type === 'building_entrance') {
          instruction += ` (${display})`
        }
      }
      // Turn instruction at hallway intersection
      else if (prev && next && (degreeMap[nodeId] ?? 0) > 2) {
        instruction = getTurnInstruction(prev, node, next)
      }
      // Room arrival
      else if (node.type === 'room' || node.type === 'room_door' || node.type === 'hallway') {
        instruction = `Continue to ${display}`
      }
      // Default
      else {
        instruction = `Continue to ${display}`
      }
    }

    return { nodeId, instruction, distance: dist }
  })
}

export function aStar(
  nodes: NavNode[],
  edges: NavEdge[],
  startId: string,
  endId: string,
  context?: { buildings?: Building[]; components?: Component[] },
): PathResult | null {
  const adj = buildAdjacencyList(edges)
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const start = nodeMap[startId]
  const end = nodeMap[endId]
  if (!start || !end) return null

  const openSet = new Set([startId])
  const gScore: Record<string, number> = {}
  const fScore: Record<string, number> = {}
  const cameFrom: Record<string, string> = {}

  for (const n of nodes) {
    gScore[n.id] = Infinity
    fScore[n.id] = Infinity
  }
  gScore[startId] = 0
  fScore[startId] = heuristic(start.position, end.position)

  while (openSet.size > 0) {
    const current = [...openSet].reduce((best, id) =>
      fScore[id] < fScore[best] ? id : best, [...openSet][0]
    )
    if (current === endId) {
      const path: string[] = []
      let c: string | undefined = current
      while (c) {
        path.unshift(c)
        c = cameFrom[c]
      }
      return {
        path,
        cost: gScore[endId],
        steps: generateInstructions(path, nodes, edges, context?.buildings, context?.components),
      }
    }
    openSet.delete(current)
    for (const neighbor of adj[current] ?? []) {
      const tentative = gScore[current] + neighbor.weight
      if (tentative < gScore[neighbor.nodeId]) {
        cameFrom[neighbor.nodeId] = current
        gScore[neighbor.nodeId] = tentative
        fScore[neighbor.nodeId] = tentative + heuristic(
          nodeMap[neighbor.nodeId].position,
          end.position
        )
        openSet.add(neighbor.nodeId)
      }
    }
  }
  return null
}

export function getAdjacencyList(edges: NavEdge[]): Record<string, { nodeId: string; weight: number }[]> {
  return buildAdjacencyList(edges)
}

export { haversine } from './geo-utils'
