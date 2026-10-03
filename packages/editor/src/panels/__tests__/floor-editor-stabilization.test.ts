import { describe, expect, it } from 'vitest'
import { buildInteriorToolGroups, ICONS } from '../ToolDock'
import { toolRegistry } from '../../tools/tool-registry'

describe('Floor Editor stabilization tool surface', () => {
  it('hides Window authoring from the architecture dock while keeping the registry definition', () => {
    const groups = buildInteriorToolGroups(toolRegistry, ICONS, 'architecture')
    const ids = groups.flatMap((group) => group.tools.map((tool) => tool.id))

    expect(ids).not.toContain('window')
    expect(toolRegistry.get('window')).toBeDefined()
  })
})
