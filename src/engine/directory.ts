import type { DirEntry } from '../types/nav-types'
import { Graph } from './graph'

export function buildDirectory(graph: Graph): DirEntry[] {
  const buildings = graph.buildings
  const nodes = graph.nodes

  return buildings.map((building) => {
    const buildingNodes = nodes.filter((n) => n.buildingId === building.id)
    const floorNumbers = [...new Set(buildingNodes.map((n) => n.floor))].sort()

    const floorEntries: DirEntry[] = floorNumbers.map((floor) => {
      const floorNodes = buildingNodes.filter((n) => n.floor === floor)
      const roomNodes = floorNodes.filter(
        (n) => n.type === 'room' || n.type === 'elevator' || n.type === 'staircase'
      )
      const entranceNodes = floorNodes.filter((n) => n.type === 'building_entrance')

      const children: DirEntry[] = [
        ...entranceNodes.map((n) => ({
          id: n.id,
          label: n.label,
          type: 'entrance' as const,
          nodeId: n.id,
        })),
        ...roomNodes.map((n) => ({
          id: n.id,
          label: n.label,
          type: 'room' as const,
          nodeId: n.id,
        })),
      ]

      return {
        id: `floor-${building.id}-${floor}`,
        label: floor === 0 ? 'Ground Floor' : `Floor ${floor}`,
        type: 'floor' as const,
        children: children.length > 0 ? children : undefined,
      }
    })

    return {
      id: building.id,
      label: building.name,
      type: 'building' as const,
      children: floorEntries.length > 0 ? floorEntries : undefined,
    }
  })
}
