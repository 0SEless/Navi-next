/**
 * Stage 4.1 — SelectionManager
 *
 * Single source of truth for "what is selected."
 *
 * Architectural rules:
 *   - NO MapLibre awareness
 *   - NO rendering logic
 *   - NO commands
 *   - Just a single selectedEntity: { type, id } | null
 *
 * Consumers (HighlightOverlay, Inspector) observe via onChange().
 * Producers (hit-testing, explorer tree) call select() / clear().
 */

export interface EntityRef {
  type: 'building' | 'room' | 'hallway' | 'road' | 'entrance' | 'staircase' | 'elevator' | 'panorama' | 'qr'
  id: string
}

type Listener = (entity: EntityRef | null) => void

export class SelectionManager {
  private _entities: EntityRef[] = []
  private listeners = new Set<Listener>()

  /** Select an entity, replacing any current selection. Pass null to clear. */
  select(entity: EntityRef | null): void {
    if (!entity) {
      this._entities = []
      this.notify()
      return
    }
    // Id-equality short-circuit: no-op if same single entity
    if (this._entities.length === 1 && this._entities[0].id === entity.id && this._entities[0].type === entity.type) {
      return
    }
    this._entities = [entity]
    this.notify()
  }

  /** Toggle an entity in/out of the selection (for Shift+click). */
  toggle(entity: EntityRef): void {
    const idx = this._entities.findIndex(e => e.id === entity.id && e.type === entity.type)
    if (idx !== -1) {
      this._entities.splice(idx, 1)
    } else {
      this._entities.push(entity)
    }
    this.notify()
  }

  /** Shorthand: select by type and id. */
  selectBy(type: EntityRef['type'], id: string): void {
    this.select({ type, id })
  }

  /** Clear selection. */
  clear(): void {
    this._entities = []
    this.notify()
  }

  /** Get the primary (first/only) selected entity, for single-select consumers. */
  get selected(): EntityRef | null {
    return this._entities.length > 0 ? this._entities[0] : null
  }

  /** Get all selected entities. */
  get allSelected(): EntityRef[] {
    return [...this._entities]
  }

  /** Get the number of selected entities. */
  get count(): number {
    return this._entities.length
  }

  /** Check if a specific entity is selected. */
  isSelected(id: string): boolean {
    return this._entities.some(e => e.id === id)
  }

  /** Subscribe to selection changes. Returns unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    const primary = this.selected
    for (const listener of this.listeners) {
      listener(primary)
    }
  }
}
