'use client'

import type { EditablePolygon } from '@/types/polygon-types'

export interface PolygonRendererStyle {
  fillColor: string
  strokeColor: string
  strokeWidth: number
  opacity: number
}

interface PolygonRendererProps {
  polygon: EditablePolygon
  style: PolygonRendererStyle
  className?: string
}

function polygonPoints(polygon: EditablePolygon): string {
  if (!polygon?.rings?.[0]?.vertices) return ''
  return polygon.rings[0].vertices
    .map(v => `${v.x},${v.y}`)
    .join(' ')
}

export function PolygonRenderer({ polygon, style, className }: PolygonRendererProps) {
  if (!polygon?.rings?.[0]?.vertices?.length) return null

  const points = polygonPoints(polygon)

  return (
    <svg className={className} style={{ position: 'absolute', pointerEvents: 'none', overflow: 'visible' }}>
      <polygon
        points={points}
        fill={style.fillColor}
        stroke={style.strokeColor}
        strokeWidth={style.strokeWidth}
        fillOpacity={style.opacity}
        strokeOpacity={style.opacity}
      />
    </svg>
  )
}
