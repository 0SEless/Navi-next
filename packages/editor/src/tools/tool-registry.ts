export interface ToolDefinition {
  id: string
  name: string
  icon: string
  category: 'geometry' | 'feature' | 'navigation' | 'utility'
  group?: string
  shortcut?: string
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`)
    }
    this.tools.set(tool.id, tool)
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId)
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  getByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return this.getAll().filter((t) => t.category === category)
  }

  getByGroup(group: string): ToolDefinition[] {
    return this.getAll().filter((t) => t.group === group)
  }

  get size(): number {
    return this.tools.size
  }
}

const registry = new ToolRegistry()

registry.register({ id: 'select', name: 'Select', icon: 'cursor', category: 'utility', group: 'geometry', shortcut: 'V' })
// Campus Map Editor tools. These IDs are the leaf IDs emitted by
// CAMPUS_TOOL_GROUPS; the `import` parent is only a dock submenu.
registry.register({ id: 'area', name: 'Area', icon: 'area', category: 'geometry', group: 'campus', shortcut: 'A' })
registry.register({ id: 'building', name: 'Building', icon: 'building', category: 'geometry', group: 'campus', shortcut: 'B' })
registry.register({ id: 'route', name: 'Road', icon: 'road', category: 'geometry', group: 'campus', shortcut: 'O' })
registry.register({ id: 'import-osm', name: 'Import from OSM', icon: 'osm-import', category: 'utility', group: 'campus' })
registry.register({ id: 'set-boundary', name: 'Set Campus Boundary', icon: 'boundary', category: 'utility', group: 'campus' })
registry.register({ id: 'space', name: 'Space', icon: 'space', category: 'geometry', group: 'geometry', shortcut: 'R' })
registry.register({ id: 'hallway', name: 'Hallway', icon: 'hallway', category: 'geometry', group: 'geometry', shortcut: 'T' })
registry.register({ id: 'wall', name: 'Wall', icon: 'wall', category: 'geometry', group: 'geometry', shortcut: 'W' })
registry.register({ id: 'door', name: 'Door', icon: 'door', category: 'geometry', group: 'geometry', shortcut: 'D' })
registry.register({ id: 'window', name: 'Window', icon: 'window', category: 'geometry', group: 'geometry', shortcut: 'N' })
registry.register({ id: 'entrance', name: 'Entrance', icon: 'entrance', category: 'feature', group: 'connections', shortcut: 'E' })
registry.register({ id: 'staircase', name: 'Staircase', icon: 'stairs', category: 'feature', group: 'connections', shortcut: 'S' })
registry.register({ id: 'elevator', name: 'Elevator', icon: 'elevator', category: 'feature', group: 'connections', shortcut: 'I' })
registry.register({ id: 'align', name: 'Align Floor Plan', icon: 'align', category: 'utility', group: 'alignment', shortcut: 'A' })
registry.register({ id: 'poi', name: 'POI', icon: 'poi', category: 'feature', group: 'feature', shortcut: 'P' })
registry.register({ id: 'poi-circle', name: 'Circle POI', icon: 'poi-circle', category: 'feature', group: 'feature' })
registry.register({ id: 'poi-rectangle', name: 'Rectangle POI', icon: 'poi-rectangle', category: 'feature', group: 'feature' })
registry.register({ id: 'poi-polygon', name: 'Polygon POI', icon: 'poi-polygon', category: 'feature', group: 'feature' })
// Route nodes and edges remain persisted graph concepts and command targets,
// but are intentionally not assigned keyboard shortcuts. The Floor Editor
// exposes one multi-click Route tool instead of separate low-level tools.
registry.register({ id: 'route-node', name: 'Route Node', icon: 'route-node', category: 'navigation', group: 'navigation' })
registry.register({ id: 'route-edge', name: 'Route Edge', icon: 'route-edge', category: 'navigation', group: 'navigation' })
registry.register({ id: 'pan', name: 'Pan', icon: 'pan', category: 'utility', group: 'utility', shortcut: 'H' })
registry.register({ id: 'measure', name: 'Measure', icon: 'ruler', category: 'utility', group: 'utility', shortcut: 'M' })
registry.register({ id: 'place-panorama', name: 'Place Panorama', icon: 'area', category: 'feature', group: 'feature', shortcut: 'P' })

export { registry as toolRegistry }
