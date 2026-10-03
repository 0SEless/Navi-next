import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanvasEditingAdapter } from './use-canvas-editing'
import { createCamera, type CameraState, type CanvasSize } from './viewport'
import type { EditablePath } from '@/types/path-types'
import type { EditablePathEditorState } from '@/components/floor-editor/useEditablePathEditor'

const camera = createCamera()
const canvasSize: CanvasSize = { width: 800, height: 600 }

const path: EditablePath = {
  id: 'h1',
  vertices: [
    { id: 'v1', x: 0, y: 0 },
    { id: 'v2', x: 10, y: 0 },
    { id: 'v3', x: 10, y: 8 },
  ],
  segments: [
    { id: 's1', startVertexId: 'v1', endVertexId: 'v2', type: 'straight' },
    { id: 's2', startVertexId: 'v2', endVertexId: 'v3', type: 'straight' },
  ],
  closed: false,
  readOnly: false,
}

function mockEditor(): EditablePathEditorState {
  return {
    session: {
      hoveredVertexId: null,
      hoveredSegmentId: null,
      selectedVertexIds: [],
      selectedSegmentId: null,
      dragVertexId: null,
      isDragging: false,
      shiftHeld: false,
    },
    onVertexPointerDown: vi.fn(),
    onSegmentPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onCanvasClick: vi.fn(),
    setShiftHeld: vi.fn(),
    setHoveredVertex: vi.fn(),
    setHoveredSegment: vi.fn(),
    insertVertex: vi.fn(),
    deleteVertex: vi.fn(),
    deleteSelected: vi.fn(),
    setSegmentType: vi.fn(),
    setCurvature: vi.fn(),
  }
}

describe('useCanvasEditingAdapter', () => {
  it('returns event handlers', () => {
    const editor = mockEditor()
    const { result } = renderHook(() =>
      useCanvasEditingAdapter({
        camera,
        canvasSize,
        path,
        editor,
        readOnly: false,
      })
    )

    expect(typeof result.current.onPointerDown).toBe('function')
    expect(typeof result.current.onPointerMove).toBe('function')
    expect(typeof result.current.onPointerUp).toBe('function')
  })

  it('calls onPointerUp on pointer up', () => {
    const editor = mockEditor()
    const { result } = renderHook(() =>
      useCanvasEditingAdapter({
        camera,
        canvasSize,
        path,
        editor,
        readOnly: false,
      })
    )

    const upEvent = new PointerEvent('pointerup', { clientX: 400, clientY: 300, pointerId: 1 })
    result.current.onPointerUp(upEvent)

    expect(editor.onPointerUp).toHaveBeenCalled()
  })

  it('does not call handlers when readOnly', () => {
    const editor = mockEditor()
    const { result } = renderHook(() =>
      useCanvasEditingAdapter({
        camera,
        canvasSize,
        path,
        editor,
        readOnly: true,
      })
    )

    const downEvent = new PointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1 })
    const canvas = document.createElement('canvas')
    result.current.onPointerDown(downEvent, canvas)

    expect(editor.onVertexPointerDown).not.toHaveBeenCalled()
    expect(editor.onSegmentPointerDown).not.toHaveBeenCalled()
    expect(editor.onCanvasClick).not.toHaveBeenCalled()
  })
})
