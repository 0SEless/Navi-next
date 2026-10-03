/**
 * Stage 4.5 — InspectorController
 *
 * Bridge between the Inspector (dumb view) and the CommandBus.
 *
 * The Inspector never sees CommandBus, never constructs commands.
 * It only calls named methods on this controller.
 *
 * This layer exists so that:
 *   - Inspector stays a dumb view (no editing logic)
 *   - Commands stay serializable (for undo/redo later)
 *   - Other inputs (keyboard, context menu, AI) can share the same controller
 */

import { CommandBus } from './command-bus'
import type { EntityRef } from '../selection/selection-manager'

export class InspectorController {
  private bus: CommandBus

  constructor(bus: CommandBus) {
    this.bus = bus
  }

  /** Update one or more properties on an entity. */
  updateEntity(entity: EntityRef, changes: Record<string, unknown>): void {
    this.bus.execute({
      type: 'entity.update',
      payload: { id: entity.id, type: entity.type, changes },
    })
  }

  /** Delete an entity. */
  deleteEntity(entity: EntityRef): void {
    this.bus.execute({
      type: 'entity.delete',
      payload: { id: entity.id, type: entity.type },
    })
  }
}
