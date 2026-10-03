export const SRC = {
  BUILDINGS: 's-buildings',
  BOUNDARY: 's-boundary',
  EDGES: 's-edges',
  NODES: 's-nodes',
  NODES_CONNECTION: 's-nodes-connection',
  TRACES: 's-traces',
  AREAS: 's-areas',
  DRAWING: 's-drawing',
  VALIDATION_FOCUS: 's-validation-focus',
} as const

export const LYR = {
  BUILDINGS_FILL: 'l-buildings-fill',
  BUILDINGS_EXTRUSION: 'l-buildings-extrusion',
  BUILDINGS_OUTLINE: 'l-buildings-outline',
  BOUNDARY_FILL: 'l-boundary-fill',
  BOUNDARY_OUTLINE: 'l-boundary-outline',
  EDGES: 'l-edges',
  NODES: 'l-nodes',
  NODES_CONNECTION: 'l-nodes-connection',
  TRACES_LINE: 'l-traces-line',
  TRACES_OUTLINE: 'l-traces-outline',
  TRACES_INNER: 'l-traces-inner',
  AREAS_FILL: 'l-areas-fill',
  AREAS_OUTLINE: 'l-areas-outline',
  DRAWING_LINE: 'l-drawing-line',
  DRAWING_POINTS: 'l-drawing-points',
  VALIDATION_FOCUS_POINT: 'l-validation-focus-point',
  VALIDATION_FOCUS_LINE: 'l-validation-focus-line',
  VALIDATION_FOCUS_POLYGON_FILL: 'l-validation-focus-polygon-fill',
  VALIDATION_FOCUS_POLYGON_OUTLINE: 'l-validation-focus-polygon-outline',
} as const

export const POI_PREVIEW_SOURCE = 's-poi-geometry-preview'
export const POI_PREVIEW_FILL = 'l-poi-geometry-preview-fill'
export const POI_PREVIEW_LINE = 'l-poi-geometry-preview-line'
export const POI_PREVIEW_VERTICES = 'l-poi-geometry-preview-vertices'

export const HIDDEN_NODE_TYPES = new Set(['room', 'staircase', 'elevator'])

// OS-native cursors — always crisp, always visible, familiar to users
export const CURSOR_CROSSHAIR = 'crosshair'
export const CURSOR_HAND = 'pointer'

export type SrcKey = keyof typeof SRC
export type LyrKey = keyof typeof LYR
