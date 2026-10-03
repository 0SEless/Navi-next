import type { ExpressionSpecification } from 'maplibre-gl'
import type { Road } from '../types/entities'
import { RoadStyle } from './road-style'

/**
 * Shared road layer paint definitions consumed by both
 * EntityRenderer (packages/editor) and MapRenderer (studio).
 *
 * Keeps the single source of truth for road visual appearance
 * in one place so style changes propagate to both renderers.
 */

/**
 * Road width expression — uses the feature's `width` property directly as
 * a fixed pixel size at all zoom levels.
 *
 * Previously this was a zoom-dependent meters→pixels interpolation, but
 * that caused two problems:
 * 1. Roads at editing zoom (17-19) were massively oversized (44px for 2m roads)
 * 2. The MapLibre error "zoom may only be used as input to a top-level step
 *    or interpolate expression" when `roadOutlinePaint` wrapped it in `['+']`
 *
 * Now road.width is stored as pixel width and used directly — simple, no zoom,
 * no compound expression nesting issues.
 */
export function roadWidthExpression(): ExpressionSpecification {
  return ['get', 'width'] as unknown as ExpressionSpecification
}

/** Two-layer road rendering: black outline behind white fill (EntityRenderer) */
export function roadOutlinePaint(): Record<string, unknown> {
  return {
    'line-color': RoadStyle.outlineColor,
    'line-width': ['+', ['get', 'width'], RoadStyle.outlineWidthPx],
    'line-opacity': 0.5,
  }
}

export function roadFillPaint(): Record<string, unknown> {
  return {
    'line-color': RoadStyle.fillColor,
    'line-width': ['get', 'width'],
    'line-opacity': 0.8,
  }
}

/** Single-layer road rendering with dynamic color (MapRenderer traces) */
export function roadTracePaint(): Record<string, unknown> {
  return {
    'line-color': ['get', 'color'],
    'line-width': ['get', 'width'],
    'line-opacity': 0.8,
  }
}

export function roadTraceInnerPaint(): Record<string, unknown> {
  return {
    'line-color': ['get', 'color'],
    'line-width': ['get', 'width'],
    'line-opacity': 0.5,
  }
}

/** Map a Road entity's type to a default color */
export function roadTypeColor(type: Road['type']): string {
  switch (type) {
    case 'arterial': return '#1C6BEB'
    case 'connector': return '#94A3B8'
    case 'service': return '#64748B'
    default: return RoadStyle.fillColor
  }
}
