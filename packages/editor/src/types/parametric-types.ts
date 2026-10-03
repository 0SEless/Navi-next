/**
 * CANONICAL LOCATION — relocated from navi-next/src/types/parametric-types.ts
 * (T0.4) so packages/editor can consume it without violating the dependency
 * direction (packages/editor must not import from navi-next/src). Content and
 * export names are byte-identical to the frozen RC-1 module; the old path is
 * now a re-export shim.
 *
 * FROZEN API — RC-1 MILESTONE
 *
 * ParametricComponent is the public contract between the Parametric Engine
 * and all consumers.
 *
 * Breaking changes require a new major version and an ADR.
 *
 * @field id           - Stable identifier
 * @field definitionId - References a ParametricDefinition by id
 * @field position     - Local coordinates {x, y} in building space
 * @field rotation     - Degrees clockwise
 * @field properties   - Type-specific parameters (stepCount, width, etc.)
 */
export interface ParametricComponent {
  id: string
  definitionId: string
  position: { x: number; y: number }
  rotation: number
  properties: Record<string, unknown>
}

/**
 * FROZEN API — RC-1 MILESTONE
 *
 * PrimitiveGeometry is the set of renderer-neutral geometry primitives.
 * Adding a new variant is a deliberate API evolution.
 */
export interface RectGeometry {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface PolylineGeometry {
  type: 'polyline'
  points: { x: number; y: number }[]
}

export interface PolygonGeometry {
  type: 'polygon'
  points: { x: number; y: number }[]
}

export interface CircleGeometry {
  type: 'circle'
  cx: number
  cy: number
  radius: number
}

export interface ArrowGeometry {
  type: 'arrow'
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface TextAnchorGeometry {
  type: 'text-anchor'
  x: number
  y: number
  text: string
}

/**
 * FROZEN API — RC-1 MILESTONE
 *
 * Union of all renderer-neutral geometry primitives.
 * Adding a new variant is a deliberate API evolution.
 */
export type PrimitiveGeometry =
  | RectGeometry
  | PolylineGeometry
  | PolygonGeometry
  | CircleGeometry
  | ArrowGeometry
  | TextAnchorGeometry

export type ParamSpecType = 'number' | 'select' | 'boolean' | 'string'

export interface ParamSpec {
  key: string
  label: string
  type: ParamSpecType
  default: unknown
  min?: number
  max?: number
  options?: { label: string; value: string }[]
}

export interface Constraint {
  type: 'min' | 'max' | 'required' | 'range'
  field: string
  message: string
  value?: number
  min?: number
  max?: number
}

export interface Diagnostic {
  type: 'error' | 'warning' | 'info'
  message: string
  componentId: string
}

/**
 * FROZEN API — RC-1 MILESTONE
 *
 * ParametricDefinition is the contract that component definitions
 * (StairDefinition, ElevatorDefinition) must implement.
 *
 * Breaking changes require a new major version and an ADR.
 *
 * @field id           - Unique identifier matching definitionId on components
 * @field create       - Factory: parameters → new component (pure)
 * @field geometry     - Pure function: component → PrimitiveGeometry[]
 * @field parameters   - Schema for the Inspector (engine never inspects names)
 * @field constraints  - Bounds for Validation, Snapping, and Transform limits
 */
export interface ParametricDefinition {
  id: string
  create(params: Record<string, unknown>): ParametricComponent
  geometry(component: ParametricComponent): PrimitiveGeometry[]
  parameters(): ParamSpec[]
  constraints(): Constraint[]
}

const STEP_DEFAULTS = { stepCount: 4, stepWidth: 1.2, stepDepth: 0.3, direction: 'east', preset: 'straight' }

export const StairDefinition: ParametricDefinition = {
  id: 'stair',
  create(params) {
    const { position, ...rest } = params as any
    return {
      id: '',
      definitionId: 'stair',
      position: position ?? { x: 0, y: 0 },
      rotation: 0,
      properties: { ...STEP_DEFAULTS, ...rest },
    }
  },
  geometry(component) {
    const { stepCount, stepWidth, stepDepth, direction } = component.properties as any
    const w = stepWidth ?? 1.2
    const d = (stepCount ?? 4) * (stepDepth ?? 0.3)
    const geo: PrimitiveGeometry[] = []
    geo.push({
      type: 'rect',
      x: component.position.x,
      y: component.position.y,
      width: w,
      height: d,
      rotation: component.rotation,
    })
    const rad = component.rotation * Math.PI / 180
    const cx = component.position.x + Math.cos(rad) * d * 0.5
    const cy = component.position.y + Math.sin(rad) * d * 0.5
    const dir = direction ?? 'east'
    let dx = w * 0.4
    let dy = 0
    if (dir === 'south') { dx = 0; dy = d * 0.4 }
    else if (dir === 'west') { dx = -w * 0.4; dy = 0 }
    else if (dir === 'north') { dx = 0; dy = -d * 0.4 }
    geo.push({
      type: 'arrow',
      from: { x: cx, y: cy },
      to: { x: cx + dx * Math.cos(rad) - dy * Math.sin(rad), y: cy + dx * Math.sin(rad) + dy * Math.cos(rad) },
    })
    return geo
  },
  parameters() {
    return [
      { key: 'stepCount', label: 'Steps', type: 'number', default: 4, min: 1, max: 50 },
      { key: 'stepWidth', label: 'Width (m)', type: 'number', default: 1.2, min: 0.5, max: 5 },
      { key: 'stepDepth', label: 'Step Depth (m)', type: 'number', default: 0.3, min: 0.1, max: 1 },
      { key: 'direction', label: 'Direction', type: 'select', default: 'east', options: [{ label: 'East', value: 'east' }, { label: 'West', value: 'west' }, { label: 'North', value: 'north' }, { label: 'South', value: 'south' }] },
      { key: 'preset', label: 'Type', type: 'select', default: 'straight', options: [{ label: 'Straight', value: 'straight' }, { label: 'L-Shape', value: 'lshape' }, { label: 'U-Shape', value: 'ushape' }, { label: 'Spiral', value: 'spiral' }] },
    ]
  },
  constraints() {
    return [
      { type: 'min', field: 'stepCount', message: 'Stairs need at least 1 step', value: 1 },
      { type: 'min', field: 'stepWidth', message: 'Width must be at least 0.5m', value: 0.5 },
      { type: 'min', field: 'stepDepth', message: 'Step depth must be at least 0.1m', value: 0.1 },
    ]
  },
}

const ELEV_DEFAULTS = { width: 1.5, depth: 1.5, doorSide: 'front' }

export const ElevatorDefinition: ParametricDefinition = {
  id: 'elevator',
  create(params) {
    const { position, ...rest } = params as any
    return {
      id: '',
      definitionId: 'elevator',
      position: position ?? { x: 0, y: 0 },
      rotation: 0,
      properties: { ...ELEV_DEFAULTS, ...rest },
    }
  },
  geometry(component) {
    const { width, depth, doorSide } = component.properties as any
    const w = width ?? 1.5
    const d = depth ?? 1.5
    const geo: PrimitiveGeometry[] = []
    geo.push({
      type: 'rect',
      x: component.position.x,
      y: component.position.y,
      width: w,
      height: d,
      rotation: component.rotation,
    })
    const rad = component.rotation * Math.PI / 180
    const cx = component.position.x
    const cy = component.position.y
    let doorX = cx + (w / 2) * Math.cos(rad)
    let doorY = cy + (w / 2) * Math.sin(rad)
    if (doorSide === 'back') { doorX = cx - (w / 2) * Math.cos(rad); doorY = cy - (w / 2) * Math.sin(rad) }
    else if (doorSide === 'left') { doorX = cx - (d / 2) * Math.sin(rad); doorY = cy + (d / 2) * Math.cos(rad) }
    else if (doorSide === 'right') { doorX = cx + (d / 2) * Math.sin(rad); doorY = cy - (d / 2) * Math.cos(rad) }
    geo.push({
      type: 'arrow',
      from: { x: cx, y: cy },
      to: { x: doorX, y: doorY },
    })
    return geo
  },
  parameters() {
    return [
      { key: 'width', label: 'Width (m)', type: 'number', default: 1.5, min: 0.8, max: 5 },
      { key: 'depth', label: 'Depth (m)', type: 'number', default: 1.5, min: 0.8, max: 5 },
      { key: 'doorSide', label: 'Door Side', type: 'select', default: 'front', options: [{ label: 'Front', value: 'front' }, { label: 'Back', value: 'back' }, { label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }] },
    ]
  },
  constraints() {
    return [
      { type: 'min', field: 'width', message: 'Width must be at least 0.8m', value: 0.8 },
      { type: 'min', field: 'depth', message: 'Depth must be at least 0.8m', value: 0.8 },
      { type: 'required', field: 'doorSide', message: 'Door side must be specified' },
    ]
  },
}

export const DEFINITIONS: Record<string, ParametricDefinition> = {
  stair: StairDefinition,
  elevator: ElevatorDefinition,
}
