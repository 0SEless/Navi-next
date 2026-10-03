export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export type DiagnosticCategory = 'parameter' | 'topology' | 'spatial' | 'document' | 'navigation'

export type DiagnosticCode =
  | 'PARAMETER_OUT_OF_RANGE'
  | 'PARAMETER_REQUIRED'
  | 'TOPOLOGY_STAIR_DISCONNECTED'
  | 'TOPOLOGY_ELEVATOR_DISCONNECTED'
  | 'TOPOLOGY_ENTRANCE_UNATTACHED'
  | 'ROUTE_NETWORK_STRUCTURE'
  | 'ROUTE_NETWORK_DISCONNECTED'
  | 'ROUTE_ROOM_ACCESS'
  | 'ROUTE_ENTRANCE_ACCESS'
  | 'ROUTE_FLOOR_CONSISTENCY'

export type EntityType = 'component' | 'room' | 'hallway' | 'building' | 'floor' | 'entrance' | 'node' | 'edge' | 'intersection'

export interface DiagnosticTarget {
  entityType?: EntityType
  entityId?: string
  entityIds?: string[]
  buildingId?: string
  floorId?: string
  layer?: 'base' | 'architecture' | 'access' | 'navigation' | 'preview'
  position?: { x: number; y: number }
}

export interface Diagnostic {
  id: string
  code: DiagnosticCode
  category: DiagnosticCategory
  severity: DiagnosticSeverity
  title: string
  message: string
  provider: string
  rule?: string
  target?: DiagnosticTarget
  fixId?: string
}

export interface DiagnosticProvider {
  id: string
  category: DiagnosticCategory
  run(document: unknown): Diagnostic[]
}

export interface TopologyRule {
  id: string
  description: string
  check(document: unknown): Diagnostic[]
}

export type EngineOptions = Partial<Record<DiagnosticCategory, boolean>>

export interface EngineResult {
  diagnostics: Diagnostic[]
  skippedProviders: string[]
  errors: { provider: string; error: string }[]
}
