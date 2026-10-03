import type { NavigationGraph, NavNode, NavEdge, ValidationResult } from '../../types'

export interface GraphValidationContext {
  readonly graph: NavigationGraph
  readonly nodeMap: ReadonlyMap<string, NavNode>
  readonly edgeMap: ReadonlyMap<string, NavEdge>
  readonly adjacency: ReadonlyMap<string, readonly string[]>
}

export interface GraphValidationRule {
  ruleId: string
  description: string
  severity: 'error' | 'warning'
  validate(context: GraphValidationContext): ValidationResult[]
}

export interface ValidationStatistics {
  nodeCount: number
  edgeCount: number
  connectedComponents: number
  isolatedNodes: number
  buildingCount: number
  floorCount: number
  roomCount: number
  hallwayCount: number
  transitionCount: number
  totalRouteLength: number
  connectivityScore: number
}

export interface ValidationReport {
  passed: boolean
  compilerVersion: string
  validatorVersion: string
  errors: ValidationResult[]
  warnings: ValidationResult[]
  statistics: ValidationStatistics
}
