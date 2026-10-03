import type { Elevator, LocalCoord, LocalPolygon, Staircase } from '@navi/core'
import { deriveLanding } from '@navi/core/src/geometry/level-geometry'
import { DEFINITIONS } from '../types/parametric-types'
import type { ParametricComponent } from '../types/parametric-types'
import { polygonizeRect } from './polygonize'

export interface ResolvedLevelGeometry {
  polygon?: LocalPolygon
  landing?: { position: LocalCoord; rotation?: number; polygon?: LocalPolygon }
}

/**
 * THE single geometry-resolution path for stair/elevator feature levels
 * (spec R1 + plan T0.4). Used by T0.5 (graph adapter), T1.x (inspector) and
 * P2 (validation) — nowhere else resolves level geometry.
 *
 * - Parametric level (`levels[level].drawing` present): calls the matching
 *   definition's `geometry()` with the drawing properties and level
 *   position/rotation, takes the RECT primitive (the footprint) and
 *   polygonizes it.
 * - Freeform level (`drawing` absent): passes `levels[level].polygon` through.
 * - Missing level: returns `{}` (no polygon, no landing).
 * - Landing: ALWAYS derived via the shared `deriveLanding` (packages/core,
 *   micro-decision 3) — never computed inline.
 *
 * Output is building-local (no world transform — that happens in the graph
 * adapter, T0.5). Deterministic: same input ⇒ same output.
 */
export function resolveLevelGeometry(
  feature: Staircase | Elevator,
  level: number,
): ResolvedLevelGeometry {
  const levelGeom = feature.levels[level]
  if (!levelGeom) return {}

  let resolvedPolygon: LocalPolygon | undefined

  if (levelGeom.drawing) {
    const definition = DEFINITIONS[levelGeom.drawing.definitionId]
    if (definition) {
      const component: ParametricComponent = {
        id: feature.id,
        definitionId: levelGeom.drawing.definitionId,
        position: levelGeom.position,
        rotation: levelGeom.rotation,
        properties: { ...levelGeom.drawing.properties },
      }
      const primitives = definition.geometry(component)
      const rect = primitives.find((p) => p.type === 'rect')
      if (rect) resolvedPolygon = polygonizeRect(rect)
    }
  } else {
    resolvedPolygon = levelGeom.polygon
  }

  const landing = deriveLanding(
    {
      position: levelGeom.position,
      rotation: levelGeom.rotation,
      polygon: resolvedPolygon ?? levelGeom.polygon,
    },
    levelGeom.landing,
  )

  return { polygon: resolvedPolygon, landing }
}