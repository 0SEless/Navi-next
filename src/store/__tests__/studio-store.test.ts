import { describe, it, expect, beforeEach } from 'vitest'
import { useStudioStore } from '../studio-store'
import { DEFAULT_LAYER_VISIBILITY } from '@/types/studio-types'

describe('useStudioStore', () => {
  beforeEach(() => {
    useStudioStore.setState({
      tool: 'select',
      editorMode: 'campus',
      activeBuildingId: null,
      activeFloor: 0,
      baseStyle: 'osm',
      positionEditTarget: null,
      layers: { ...DEFAULT_LAYER_VISIBILITY },
    })
  })

  it('sets tool', () => {
    useStudioStore.getState().setTool('route')
    expect(useStudioStore.getState().tool).toBe('route')
  })

  it('sets editor mode', () => {
    useStudioStore.getState().setEditorMode('building')
    expect(useStudioStore.getState().editorMode).toBe('building')
  })

  it('sets active building', () => {
    useStudioStore.getState().setActiveBuilding('BLD01')
    expect(useStudioStore.getState().activeBuildingId).toBe('BLD01')
  })

  it('sets active floor', () => {
    useStudioStore.getState().setActiveFloor(2)
    expect(useStudioStore.getState().activeFloor).toBe(2)
  })

  it('toggles layer visibility', () => {
    useStudioStore.getState().toggleLayer('nodes')
    expect(useStudioStore.getState().layers.nodes).toBe(true)
  })

  it('keeps navigation-only routes hidden from the diagnostic view by default', () => {
    expect(useStudioStore.getState().layers.navigation_only_routes).toBe(false)
    useStudioStore.getState().toggleLayer('navigation_only_routes')
    expect(useStudioStore.getState().layers.navigation_only_routes).toBe(true)
  })

  it('sets base style', () => {
    useStudioStore.getState().setBaseStyle('dark')
    expect(useStudioStore.getState().baseStyle).toBe('dark')
  })

  it('sets position edit target', () => {
    useStudioStore.getState().setPositionEditTarget({ type: 'building', id: 'BLD01' })
    expect(useStudioStore.getState().positionEditTarget).toEqual({ type: 'building', id: 'BLD01' })
  })

  it('clears position edit target', () => {
    useStudioStore.getState().setPositionEditTarget({ type: 'building', id: 'BLD01' })
    useStudioStore.getState().setPositionEditTarget(null)
    expect(useStudioStore.getState().positionEditTarget).toBeNull()
  })
})
