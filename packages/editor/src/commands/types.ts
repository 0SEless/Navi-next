import type { CampusDocument } from '@navi/core'

export interface Command {
  id: string
  label: string
  payload: Record<string, unknown>
}

export interface CommandHandler {
  id: string
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult
  inverse?(payload: Record<string, unknown>, result: MutationResult): Command | null
}

export interface MutationResult {
  success: boolean
  entityId?: string
  data?: Record<string, unknown>
  error?: string
}

/** Result of an all-or-none sequence of existing editor commands. */
export interface BatchMutationResult {
  success: boolean
  results: MutationResult[]
  error?: string
  failedCommandIndex?: number
}

export interface PreHook {
  id: string
  before(command: Command, document: CampusDocument): void | Promise<void>
}

export interface PostHook {
  id: string
  after(command: Command, result: MutationResult, document: CampusDocument): void | Promise<void>
  /** Called once after an all-or-none batch commits successfully. */
  afterBatch?(commands: Command[], results: MutationResult[], document: CampusDocument, snapshotBefore: CampusDocument): void | Promise<void>
}
