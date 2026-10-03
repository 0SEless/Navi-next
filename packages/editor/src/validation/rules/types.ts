import type { CampusDocument } from '@navi/core'
import type { AnalysisCache, ValidationIssue } from '../snapshot'

/**
 * Placeholder — refined in M3.5.6 (Validation Profiles).
 * Tolerances + per-rule severity overrides + future feature flags.
 */
export interface ProfileConfig {
  readonly tolerances: Readonly<Record<string, number>>
  readonly severityOverrides: Readonly<Record<string, 'error' | 'warning' | 'info'>>
  readonly flags?: Readonly<Record<string, boolean>>
}

export type ValidationProfileId = 'draft' | 'publish' | 'strict'

export interface ValidationProfile {
  readonly id: ValidationProfileId
  readonly label: string
  readonly description: string
  readonly tolerances: Record<string, number>
  readonly severityOverrides?: Record<string, 'error' | 'warning' | 'info'>
}

export type ValidationAffinity =
  | 'global'
  | 'entity:building'
  | 'entity:floor'
  | 'entity:room'
  | 'entity:hallway'
  | 'entity:staircase'
  | 'entity:elevator'
  | 'entity:entrance'
  | 'entity:road'
  | 'entity:panorama'
  | 'entity:checkpoint'
  | 'entity:connector_stop'
  | 'entity:vertical_connector'
  | 'entity:room_door'

export interface ValidationContext {
  readonly document: CampusDocument
  readonly profile: ValidationProfileId
  readonly analysis: AnalysisCache
  readonly config: ProfileConfig
}

export interface ValidationRule {
  readonly ruleId: string
  readonly description: string
  readonly category: string
  readonly defaultSeverity: 'error' | 'warning' | 'info'
  readonly profiles: ReadonlyArray<ValidationProfileId>
  readonly affinity: ValidationAffinity

  readonly defaults?: {
    readonly tolerances?: Readonly<Record<string, number>>
  }

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue>
}
