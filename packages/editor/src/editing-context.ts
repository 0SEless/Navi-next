import type { CampusDocument } from '@navi/core'
import { BaseEditorService } from './context'
import type { EditorServiceContext } from './context/service-registry'
import type { DocumentEventBus } from './eventbus'

export type EditorMode = 'campus' | 'building' | 'floor' | '360-tour'

/**
 * EditingContextService owns the *current editing context* — which of the
 * Campus / Building / Floor hierarchies the user is editing.
 *
 * It owns ONLY `mode`. Building and floor identity live in `Viewport`
 * (activeBuildingId / activeFloorId); tool selection lives in `CurrentToolStore`.
 * This service deliberately does not duplicate that ownership.
 */
export class EditingContextService extends BaseEditorService {
  readonly id = 'editingContext'
  readonly dependencies: readonly string[] = ['eventBus']

  private _mode: EditorMode = 'campus'
  private eventBus!: DocumentEventBus

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.eventBus = context.get('eventBus')
  }

  get mode(): EditorMode {
    return this._mode
  }

  setMode(mode: EditorMode): void {
    if (this._mode === mode) return
    this._mode = mode
    this.eventBus.emit('editingcontext.changed', { mode })
  }
}
