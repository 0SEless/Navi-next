import type { CampusDocument } from '@navi/core'
import type { ValidationIssue } from '../snapshot'
import type { Command } from '../../commands/types'

export interface FixContext {
  readonly document: CampusDocument
}

export interface FixProvider {
  readonly fixId: string
  readonly label: string
  readonly description: string
  canFix(issue: ValidationIssue, context: FixContext): boolean
  createCommand(issue: ValidationIssue, context: FixContext): Command | null
}
