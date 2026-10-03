/**
 * P3-T1: React component that renders a Canvas viewport.
 *
 * Owns the <canvas> element, manages camera state, runs the render loop.
 * Does NOT handle events (P3-T3) or document state (P3-T2).
 */

import React, { forwardRef, useImperativeHandle } from 'react'
import { useCanvasViewport, type CanvasViewportRef, type UseCanvasViewportResult } from './use-canvas-viewport'
import type { FloorGeometryFloor } from '@navi/core'
import type { FloorRenderContext } from './floor-renderer'

export interface CanvasViewportProps {
  /** Floor geometry to render. Null = empty canvas. */
  floor?: FloorGeometryFloor | null
  /** Render style override. */
  style?: FloorRenderContext
  /** CSS class name for the container. */
  className?: string
  /** CSS style for the container. */
  containerStyle?: React.CSSProperties
}

export interface CanvasViewportHandle {
  viewport: UseCanvasViewportResult
}

export const CanvasViewport = forwardRef<CanvasViewportHandle, CanvasViewportProps>(
  function CanvasViewport({ floor, style, className, containerStyle }, ref) {
    const viewportRef = React.useRef<CanvasViewportRef>(null)
    const viewport = useCanvasViewport(viewportRef, { floor, style })

    useImperativeHandle(ref, () => ({
      viewport,
    }), [viewport])

    return (
      <div
        ref={viewport.containerRef}
        className={className}
        style={{ width: '100%', height: '100%', position: 'relative', ...containerStyle }}
      >
        <canvas
          ref={viewport.canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    )
  }
)
