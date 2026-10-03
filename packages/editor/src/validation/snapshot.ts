export type ValidationState = 'valid' | 'warnings' | 'errors'

export interface ValidationIssueTarget {
  readonly entityId: string
  readonly entityType: string
}

export interface ValidationIssue {
  readonly issueId: string
  readonly ruleId: string
  readonly severity: 'error' | 'warning' | 'info'
  readonly message: string
  readonly targets: ReadonlyArray<ValidationIssueTarget>
  /** Optional authored-layer scope for cross-cutting rules. */
  readonly buildingId?: string
  readonly floorId?: string
  readonly layer?: 'base' | 'architecture' | 'access' | 'navigation' | 'preview'
  readonly location?: { readonly x: number; readonly y: number }
  readonly fixId?: string
}

export interface ValidationStatistics {
  readonly duration: number
  readonly totalIssues: number
  readonly errors: number
  readonly warnings: number
  readonly infos: number
  readonly rulesExecuted: number
  readonly rulesReused: number
  readonly rulesPassed: number
  readonly rulesFailed: number
}

export interface GraphAnalysis {
  readonly connectedComponentCount: number
  readonly nodeCount: number
  readonly edgeCount: number
}

export interface GeometryAnalysis {
  readonly polygonCount: number
  readonly zeroAreaPolygonIds: ReadonlyArray<string>
}

export interface MetadataIndex {
  readonly entityCount: number
  readonly unnamedEntityIds: ReadonlyArray<string>
}

export interface SpatialIndex {
  readonly isBuilt: boolean
}

export interface AnalysisCache {
  readonly graph?: GraphAnalysis
  readonly geometry?: GeometryAnalysis
  readonly metadata?: MetadataIndex
  readonly spatial?: SpatialIndex
}

export interface ValidationSnapshot {
  readonly epoch: number
  readonly documentId: string
  readonly documentVersion: number
  readonly profile: string
  readonly validatedAt: DOMHighResTimeStamp
  readonly state: ValidationState
  readonly issues: ReadonlyArray<ValidationIssue>
  readonly statistics: ValidationStatistics
  readonly analysisCache: AnalysisCache
}

export interface SnapshotParams {
  epoch: number
  documentId: string
  documentVersion: number
  profile: string
  validatedAt: DOMHighResTimeStamp
  state: ValidationState
  issues: ReadonlyArray<ValidationIssue>
  statistics: ValidationStatistics
  analysisCache: AnalysisCache
}

export function buildSnapshot(params: SnapshotParams): ValidationSnapshot {
  return Object.freeze({
    epoch: params.epoch,
    documentId: params.documentId,
    documentVersion: params.documentVersion,
    profile: params.profile,
    validatedAt: params.validatedAt,
    state: params.state,
    issues: Object.freeze([...params.issues]),
    statistics: Object.freeze({ ...params.statistics }),
    analysisCache: Object.freeze({ ...params.analysisCache }),
  })
}
