/**
 * Stage 4.5 — CommandHistory
 *
 * Lightweight undo/redo for the CommandBus.
 * Snapshots the full CampusDocument before each mutation.
 */

import type { CampusDocument } from '@navi/core'

export class CommandHistory {
  private past: string[] = []
  private future: string[] = []
  private maxSize: number

  constructor(maxSize = 50) {
    this.maxSize = maxSize
  }

  /** Record a snapshot BEFORE a command executes. */
  push(snapshot: CampusDocument): void {
    this.past.push(JSON.stringify(snapshot))
    this.future = []
    if (this.past.length > this.maxSize) this.past.shift()
  }

  /** Restore the previous snapshot. Returns true if undo was available. */
  undo(current: CampusDocument | null): boolean {
    if (this.past.length === 0 || !current) return false
    this.future.push(JSON.stringify(current))
    const prev = JSON.parse(this.past.pop()!)
    Object.assign(current, prev)
    return true
  }

  /** Restore the next snapshot. Returns true if redo was available. */
  redo(current: CampusDocument | null): boolean {
    if (this.future.length === 0 || !current) return false
    this.past.push(JSON.stringify(current))
    const next = JSON.parse(this.future.pop()!)
    Object.assign(current, next)
    return true
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }
}
