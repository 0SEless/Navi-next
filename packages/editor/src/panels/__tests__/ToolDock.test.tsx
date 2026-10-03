import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(cleanup)
import { ToolDock, INTERIOR_TOOL_GROUPS, CAMPUS_TOOL_GROUPS, useToolDockShortcuts } from '../ToolDock'
import type { ToolGroup } from '../ToolDock'
import { toolRegistry } from '../../tools/tool-registry'

const EMPTY_GROUPS: ToolGroup[] = []

function renderDock(props?: { activeTool?: string; onActivate?: () => void }) {
  const onActivate = props?.onActivate ?? vi.fn()
  return {
    onActivate,
    ...render(
      <ToolDock
        groups={INTERIOR_TOOL_GROUPS}
        activeTool={props?.activeTool ?? 'select'}
        onActivateTool={onActivate}
      />,
    ),
  }
}

describe('ToolDock', () => {
  it('renders all interior tool groups', () => {
    renderDock()
    expect(screen.getByTitle(/Navigate/)).toBeDefined()
    expect(screen.getByTitle(/Room/)).toBeDefined()
    expect(screen.getByTitle(/Hallway/)).toBeDefined()
    expect(screen.getByTitle(/Entrance/)).toBeDefined()
    expect(screen.getByTitle(/Stair/)).toBeDefined()
    expect(screen.getByTitle(/Elevator/)).toBeDefined()
  })

  it('renders campus tool groups with the retired Area tool absent', () => {
    render(
      <ToolDock groups={CAMPUS_TOOL_GROUPS} activeTool="select" onActivateTool={vi.fn()} />,
    )
    expect(screen.getByTitle(/Navigate/)).toBeDefined()
    expect(screen.queryByTitle(/^Area/)).toBeNull()
    expect(screen.getByTitle(/Import/)).toBeDefined()
    expect(screen.getByTitle(/Building/)).toBeDefined()
    expect(screen.getByTitle(/Road/)).toBeDefined()
    expect(screen.getByTitle(/POI/)).toBeDefined()
  })

  it('shows keyboard shortcut on hover', () => {
    renderDock()
    const spaceBtn = screen.getByTitle(/Room/)
    fireEvent.mouseEnter(spaceBtn)
    expect(spaceBtn.getAttribute('title')).toContain('(R)')
  })

  it('renders nothing for empty groups', () => {
    const { container } = render(
      <ToolDock groups={EMPTY_GROUPS} activeTool="select" onActivateTool={vi.fn()} />,
    )
    const dock = container.querySelector('div')
    expect(dock?.children.length ?? 0).toBe(0)
  })

  it('calls onActivateTool when button clicked', () => {
    const { onActivate } = renderDock()
    const spaceBtn = screen.getByTitle(/Room/)
    fireEvent.click(spaceBtn)
    expect(onActivate).toHaveBeenCalledWith('space')
  })

  it('highlights active tool', () => {
    const { container } = renderDock({ activeTool: 'hallway' })
    const buttons = container.querySelectorAll('button')
    const activeBtn = Array.from(buttons).find((b) =>
      b.style.border.includes('var(--navi-primary)'),
    )
    expect(activeBtn).toBeDefined()
  })
})

describe('INTERIOR_TOOL_GROUPS', () => {
  it('has geometry, connections, and alignment groups', () => {
    const ids = INTERIOR_TOOL_GROUPS.map((g) => g.id)
    expect(ids).toContain('geometry')
    expect(ids).toContain('connections')
    expect(ids).toContain('alignment')
  })

  it('geometry group has select, space, and hallway', () => {
    const geom = INTERIOR_TOOL_GROUPS.find((g) => g.id === 'geometry')
    expect(geom?.tools.map((t) => t.id)).toEqual(['select', 'space', 'hallway'])
  })
})

describe('CAMPUS_TOOL_GROUPS', () => {
  it('has geometry group only', () => {
    const ids = CAMPUS_TOOL_GROUPS.map((g) => g.id)
    expect(ids).toEqual(['geometry'])
  })

  it('geometry group has select, import, building, route, and POI (Area tool retired)', () => {
    const geom = CAMPUS_TOOL_GROUPS.find((g) => g.id === 'geometry')
    expect(geom?.tools.map((t) => t.id)).toEqual(['select', 'import', 'building', 'route', 'poi'])
  })

  it('no longer offers a separate Area authoring tool', () => {
    const toolIds = CAMPUS_TOOL_GROUPS.flatMap((group) =>
      group.tools.flatMap((tool) => tool.subItems?.map((subItem) => subItem.id) ?? [tool.id]),
    )
    expect(toolIds).not.toContain('area')
  })

  it('has import parent tool with subItems', () => {
    const geom = CAMPUS_TOOL_GROUPS.find((g) => g.id === 'geometry')
    const importTool = geom?.tools.find((t) => t.id === 'import')
    expect(importTool).toBeDefined()
    expect(importTool?.subItems).toHaveLength(2)
    const subIds = importTool?.subItems?.map((s) => s.id) ?? []
    expect(subIds).toContain('import-osm')
    expect(subIds).toContain('set-boundary')
  })

  it('registers every campus leaf tool in the shared registry', () => {
    const leafIds = CAMPUS_TOOL_GROUPS.flatMap((group) =>
      group.tools.flatMap((tool) => tool.subItems?.map((subItem) => subItem.id) ?? [tool.id]),
    ).filter((id) => id !== 'import')

    for (const id of leafIds) {
      expect(toolRegistry.get(id), `${id} should be registered`).toBeDefined()
    }
  })
})
