import { describe, expect, it } from 'vitest'
import { CAMPUS_TOOL_GROUPS } from '../ToolDock'

describe('Phase 3A point POI tool entry', () => {
  it('exposes the point-only POI tool in the active campus dock', () => {
    const geometry = CAMPUS_TOOL_GROUPS.find(group => group.id === 'geometry')

    expect(geometry?.tools.map(tool => tool.id)).toContain('poi')
  })

  it('keeps one POI parent with Point, Circle, Rectangle, and Polygon leaves', () => {
    const geometry = CAMPUS_TOOL_GROUPS.find(group => group.id === 'geometry')
    const poi = geometry?.tools.find(tool => tool.id === 'poi')

    expect(poi?.subItems?.map(item => item.id)).toEqual([
      'poi', 'poi-circle', 'poi-rectangle', 'poi-polygon',
    ])
  })
})
