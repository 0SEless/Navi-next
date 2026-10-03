import { describe, it, expect } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import {
  LAYER_IDS, SOURCE_IDS, BUILDING_CATEGORY_COLORS, ROOM_CATEGORY_COLORS,
  ENTITY_ICON_COLORS, buildingFillPaint, roomFillPaint, entityCirclePaint,
  poiFillPaint, poiOutlinePaint, poiCirclePaint,
  navigationOnlyRoadPaint,
} from './layers'
import * as layerApi from './layers'

describe('LAYER_IDS', () => {
  it('contains all expected layer IDs', () => {
    const expected = ['BUILDING_FILL', 'BUILDING_OUTLINE', 'ROOM_FILL', 'ROOM_OUTLINE', 'HALLWAY_LINE', 'ROAD_OUTLINE', 'ROAD_FILL', 'NAVIGATION_ONLY_ROAD', 'ENTRANCE_ICON', 'STAIRCASE_ICON', 'ELEVATOR_ICON', 'PANORAMA_ICON', 'QR_ICON', 'POI_ICON', 'POI_FILL', 'POI_EXTRUSION', 'POI_OUTLINE', 'SELECTION_OVERLAY', 'HOVER_HIGHLIGHT', 'PREVIEW', 'VALIDATION_OVERLAY']
    for (const key of expected) {
      expect(LAYER_IDS).toHaveProperty(key)
    }
  })

  it('has no duplicate values across LAYER_IDS', () => {
    const values = Object.values(LAYER_IDS)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('SOURCE_IDS', () => {
  it('contains all expected source IDs', () => {
    const expected = ['BUILDINGS', 'ROOMS', 'HALLWAYS', 'ROADS', 'ENTRANCES', 'STAIRCASES', 'ELEVATORS', 'PANORAMAS', 'QR', 'POIS', 'PREVIEW', 'SELECTION']
    for (const key of expected) {
      expect(SOURCE_IDS).toHaveProperty(key)
    }
  })

  it('has no duplicate values across SOURCE_IDS', () => {
    const values = Object.values(SOURCE_IDS)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('BUILDING_CATEGORY_COLORS', () => {
  it('has all expected building categories', () => {
    const expected = ['academic', 'residential', 'administrative', 'facility', 'library', 'dining', 'sports', 'parking', 'health', 'other']
    for (const cat of expected) {
      expect(BUILDING_CATEGORY_COLORS).toHaveProperty(cat)
      expect(BUILDING_CATEGORY_COLORS[cat]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('ROOM_CATEGORY_COLORS', () => {
  it('has all expected room categories', () => {
    const expected = ['classroom', 'office', 'lab', 'restroom', 'stairwell', 'elevator_lobby', 'lobby', 'storage', 'meeting', 'auditorium', 'server', 'utility', 'other']
    for (const cat of expected) {
      expect(ROOM_CATEGORY_COLORS).toHaveProperty(cat)
      expect(ROOM_CATEGORY_COLORS[cat]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('ENTITY_ICON_COLORS', () => {
  it('has all expected entity types', () => {
    const expected = ['entrance', 'staircase', 'elevator', 'panorama', 'qr']
    for (const key of expected) {
      expect(ENTITY_ICON_COLORS).toHaveProperty(key)
      expect(ENTITY_ICON_COLORS[key]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('buildingFillPaint', () => {
  it('returns correct paint with fill-opacity', () => {
    const paint = buildingFillPaint()
    expect(paint).toHaveProperty('fill-color')
    expect(paint).toHaveProperty('fill-opacity')
    // fill-opacity is a MapLibre expression: ["case", ..., 0.35, ..., 0.4, 0.25]
    const opacity = paint['fill-opacity'] as any
    expect(Array.isArray(opacity)).toBe(true)
    expect(opacity[0]).toBe('case')
    expect(opacity).toContain(0.35) // default opacity
  })
})

describe('roomFillPaint', () => {
  it('returns correct paint with match expression', () => {
    const paint = roomFillPaint()
    expect(paint).toHaveProperty('fill-color')
    expect(Array.isArray(paint['fill-color'])).toBe(true)
    expect(paint['fill-color'][0]).toBe('match')
    expect(paint).toHaveProperty('fill-opacity', 0.4)
  })
})

describe('entityCirclePaint', () => {
  it('returns correct color for known entity type', () => {
    const paint = entityCirclePaint('entrance')
    expect(paint['circle-color']).toBe('#FF8C00')
    expect(paint['circle-radius']).toBe(6)
  })

  it('returns fallback color for unknown entity type', () => {
    const paint = entityCirclePaint('unknown_type')
    expect(paint['circle-color']).toBe('#888')
  })
})

describe('POI geometry paint', () => {
  it('uses fixed authoring fill and outline paint with feature-state selection', () => {
    const fill = poiFillPaint()
    const outline = poiOutlinePaint()
    const circle = poiCirclePaint()

    expect(fill['fill-opacity']).toBeDefined()
    expect(outline['line-width']).toBeDefined()
    expect(circle['circle-radius']).toBeDefined()
    expect(JSON.stringify(fill)).toContain('selected')
    expect(JSON.stringify(outline)).toContain('hover')
  })

  it('provides feature-state-aware lightweight 2.5D extrusion paint', () => {
    const extrusion = (layerApi as unknown as { poiExtrusionPaint?: () => Record<string, unknown> }).poiExtrusionPaint
    expect(typeof extrusion).toBe('function')
    if (!extrusion) return

    const paint = extrusion()
    expect(paint['fill-extrusion-height']).toEqual(['get', 'appearanceHeight'])
    expect(paint['fill-extrusion-base']).toEqual(['get', 'base_elevation'])
    expect(JSON.stringify(paint)).toContain('selected')
    expect(JSON.stringify(paint)).toContain('hover')
  })
})

describe('navigationOnlyRoadPaint', () => {
  it('uses a faint dashed line for diagnostic-only routes', () => {
    const paint = navigationOnlyRoadPaint()
    expect(paint['line-dasharray']).toEqual([2, 2])
    expect(paint['line-opacity']).toBeLessThan(0.6)
  })
})

describe('MapLibre style-spec validity', () => {
  /**
   * Regression: `fill-extrusion-opacity` is a data-constant property and does
   * NOT accept data expressions. Passing a feature-state `case` expression made
   * MapLibre reject the layer at runtime with:
   *   layers.navi-poi-extrusion.paint.fill-extrusion-opacity: data expressions not supported
   */
  it('POI extrusion layer passes style-spec validation', () => {
    const styleValidation = {
      version: 8,
      name: 'editor-layer-validity',
      sources: {
        [SOURCE_IDS.POIS]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [{
        id: LAYER_IDS.POI_EXTRUSION,
        type: 'fill-extrusion',
        source: SOURCE_IDS.POIS,
        paint: layerApi.poiExtrusionPaint(),
      }],
    }
    const errors = validateStyleMin(styleValidation as never)
    const messages = errors.map((error) => error.message)
    expect(messages).toEqual([])
  })

  it('extrusion paint keeps the 2.5D shapes and feature-state response', () => {
    const paint = layerApi.poiExtrusionPaint()
    expect(paint['fill-extrusion-height']).toEqual(['get', 'appearanceHeight'])
    expect(paint['fill-extrusion-base']).toEqual(['get', 'base_elevation'])
    // Opacity variation moved into the data-driven color channel (rgba alpha).
    expect(JSON.stringify(paint['fill-extrusion-color'])).toContain('selected')
    const opacity = paint['fill-extrusion-opacity'] as unknown
    expect(opacity === undefined || typeof opacity === 'number').toBe(true)
  })

  it('every editor layer paint spec passes style-spec validation', () => {
    // One invalid layer aborts the whole EntityRenderer.addLayers loop, so
    // validate the full set rather than only the layer that failed at runtime.
    const layerSpecs = [
      { id: LAYER_IDS.BUILDING_EXTRUSION, type: 'fill-extrusion', paint: layerApi.buildingExtrusionPaint() },
      { id: LAYER_IDS.BUILDING_FILL, type: 'fill', paint: layerApi.buildingFillPaint() },
      { id: LAYER_IDS.BUILDING_OUTLINE, type: 'line', paint: layerApi.buildingOutlinePaint() },
      { id: LAYER_IDS.ROOM_FILL, type: 'fill', paint: layerApi.roomFillPaint() },
      { id: LAYER_IDS.ROOM_OUTLINE, type: 'line', paint: layerApi.roomOutlinePaint() },
      { id: LAYER_IDS.HALLWAY_LINE, type: 'line', paint: layerApi.hallwayLinePaint() },
      { id: LAYER_IDS.ROAD_OUTLINE, type: 'line', paint: layerApi.roadOutlinePaint() },
      { id: LAYER_IDS.ROAD_FILL, type: 'line', paint: layerApi.roadFillPaint() },
      { id: LAYER_IDS.NAVIGATION_ONLY_ROAD, type: 'line', paint: layerApi.navigationOnlyRoadPaint() },
      { id: LAYER_IDS.PATH_LINE, type: 'line', paint: layerApi.pathLinePaint() },
      { id: LAYER_IDS.ENTRANCE_ICON, type: 'circle', paint: layerApi.entityCirclePaint('entrance') },
      { id: LAYER_IDS.POI_FILL, type: 'fill', paint: layerApi.poiFillPaint() },
      { id: LAYER_IDS.POI_EXTRUSION, type: 'fill-extrusion', paint: layerApi.poiExtrusionPaint() },
      { id: LAYER_IDS.POI_OUTLINE, type: 'line', paint: layerApi.poiOutlinePaint() },
      { id: LAYER_IDS.POI_ICON, type: 'circle', paint: layerApi.poiCirclePaint() },
      { id: LAYER_IDS.SELECTION_OVERLAY, type: 'line', paint: layerApi.selectionPaint() },
      { id: LAYER_IDS.HOVER_HIGHLIGHT, type: 'line', paint: layerApi.hoverPaint() },
      { id: LAYER_IDS.PREVIEW, type: 'line', paint: layerApi.previewPaint() },
      { id: LAYER_IDS.VALIDATION_OVERLAY, type: 'line', paint: layerApi.validationPaint() },
    ]

    const styleValidation = {
      version: 8,
      name: 'editor-all-layers-validity',
      sources: {
        [SOURCE_IDS.POIS]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: layerSpecs.map((spec) => ({
        id: spec.id,
        type: spec.type,
        source: SOURCE_IDS.POIS,
        paint: spec.paint,
      })),
    }

    const errors = validateStyleMin(styleValidation as never)
    expect(errors.map((error) => error.message)).toEqual([])
  })
})
