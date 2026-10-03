import type { CampusDocument } from '@navi/core'
import { BaseEditorService } from './context'
import type { EditorServiceContext } from './context/service-registry'
import type { DocumentEventBus } from './eventbus'
import type { EntitySelector, SelectionMode, SelectionOrigin, SelectionState } from './context/entity-id'
import { asEntityId } from './context/entity-id'

export { SelectionOrigin } from './context/entity-id'
export type { EntitySelector, SelectionMode, SelectionState } from './context/entity-id'

/**
 * Input type for select/toggle — accepts either a raw string ID
 * or a fully-qualified EntitySelector.
 */
export type SelectionInput = string | EntitySelector

/** Resolve a SelectionInput to a plain string ID. */
function resolveId(input: SelectionInput): string {
  return typeof input === 'string' ? input : input.id
}

/** Resolve a SelectionInput to an EntitySelector (pass-through if already one). */
function resolveSelector(input: SelectionInput): EntitySelector {
  return typeof input === 'string'
    ? { type: 'building' as const, id: asEntityId(input) }
    : input
}

export class SelectionManager extends BaseEditorService {
  readonly id = 'selection'
  readonly dependencies: readonly string[] = ['eventBus']

  private entityIds = new Set<string>()
  private entitySelectors = new Map<string, EntitySelector>()
  private _hoveredEntityId: string | null = null
  private _hoveredSelector: EntitySelector | null = null
  private _lastSelectedId: string | null = null
  private _lastSelectedSelector: EntitySelector | null = null
  private _mode: SelectionMode = 'single'
  private _origin: SelectionOrigin = 'programmatic' as SelectionOrigin
  private document!: CampusDocument
  private eventBus!: DocumentEventBus

  // ── listener support (for SelectionStore) ──────────────────

  // ── revision counter for external store sync ───────────────
  private _revision = 0
  private cachedState: SelectionState | null = null

  /** Monotonically increasing revision counter. Bumps on every mutation. */
  get revision(): number {
    return this._revision
  }

  /** Returns the current SelectionState, cached and reused until the next mutation. */
  get selectionState(): SelectionState {
    if (!this.cachedState) {
      this.cachedState = {
        selected: this.selectors,
        hovered: this._hoveredSelector,
        mode: this._mode,
        origin: this._origin,
        lastSelected: this._lastSelectedSelector,
      }
    }
    return this.cachedState
  }

  private changeListeners = new Set<() => void>()

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn)
    return () => this.changeListeners.delete(fn)
  }

  // ── construction / init ──────────────────────────────────────

  constructor(document?: CampusDocument, eventBus?: DocumentEventBus) {
    super()
    if (document) this.document = document
    if (eventBus) this.eventBus = eventBus
  }

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.eventBus = context.get('eventBus')
    this.document = context.document
  }

  // ── mode ────────────────────────────────────────────────────

  get mode(): SelectionMode {
    return this._mode
  }

  setMode(mode: SelectionMode): void {
    this._mode = mode
    this.notify()
  }

  // ── origin ──────────────────────────────────────────────────

  get origin(): SelectionOrigin {
    return this._origin
  }

  // ── select / toggle / clear ──────────────────────────────────

  select(input: SelectionInput, origin?: SelectionOrigin): void {
    this._origin = origin ?? ('canvas' as SelectionOrigin)
    const id = resolveId(input)
    if (this.entityIds.size === 1 && this.entityIds.has(id) && this._lastSelectedId === id) {
      return
    }
    const sel = resolveSelector(input)
    this.clearInternal()
    this.entityIds.add(id)
    this.entitySelectors.set(id, sel)
    this._lastSelectedId = id
    this._lastSelectedSelector = sel
    this.notify()
  }

  toggle(input: SelectionInput, origin?: SelectionOrigin): void {
    this._origin = origin ?? ('canvas' as SelectionOrigin)
    const id = resolveId(input)
    const sel = resolveSelector(input)
    if (this.entityIds.has(id)) {
      this.entityIds.delete(id)
      this.entitySelectors.delete(id)
      if (this._lastSelectedId === id) {
        this._lastSelectedId = this.entityIds.values().next().value || null
        this._lastSelectedSelector = this._lastSelectedId
          ? this.entitySelectors.get(this._lastSelectedId) ?? null
          : null
      }
    } else {
      this.entityIds.add(id)
      this.entitySelectors.set(id, sel)
      this._lastSelectedId = id
      this._lastSelectedSelector = sel
    }
    this.notify()
  }

  clear(origin?: SelectionOrigin): void {
    if (origin !== undefined) this._origin = origin
    this.clearInternal()
    this.notify()
  }

  // ── queries ─────────────────────────────────────────────────

  isSelected(id: string): boolean {
    return this.entityIds.has(id)
  }

  get selectedIds(): string[] {
    return Array.from(this.entityIds)
  }

  get selectors(): EntitySelector[] {
    return Array.from(this.entitySelectors.values())
  }

  get count(): number {
    return this.entityIds.size
  }

  // ── hover ───────────────────────────────────────────────────

  setHover(input: SelectionInput | null): void {
    if (input === null) {
      this._hoveredEntityId = null
      this._hoveredSelector = null
    } else {
      this._hoveredEntityId = resolveId(input)
      this._hoveredSelector = resolveSelector(input)
    }
    this.notify()
  }

  clearHover(): void {
    this._hoveredEntityId = null
    this._hoveredSelector = null
    this.notify()
  }

  get hoveredEntityId(): string | null {
    return this._hoveredEntityId
  }

  get hoveredSelector(): EntitySelector | null {
    return this._hoveredSelector
  }

  get lastSelectedId(): string | null {
    return this._lastSelectedId
  }

  get lastSelectedSelector(): EntitySelector | null {
    return this._lastSelectedSelector
  }

  // ── lifecycle helpers ───────────────────────────────────────

  resetOnToolChange(): void {
    this.clearInternal()
    this._hoveredEntityId = null
    this._hoveredSelector = null
    this.notify()
  }

  // ── state snapshots ─────────────────────────────────────────

  get selectionState(): SelectionState {
    return {
      selected: this.selectors,
      hovered: this._hoveredSelector,
      mode: this._mode,
      origin: this._origin,
      lastSelected: this._lastSelectedSelector,
    }
  }

  // ── bounding box (building-only for now) ─────────────────────

  get boundingBox(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const ids = this.selectedIds
    if (ids.length === 0) return null

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const bld of this.document.buildings) {
      if (!ids.includes(bld.id)) continue
      for (const pt of bld.footprint.points) {
        if (pt.lng < minX) minX = pt.lng
        if (pt.lat < minY) minY = pt.lat
        if (pt.lng > maxX) maxX = pt.lng
        if (pt.lat > maxY) maxY = pt.lat
      }
    }

    if (minX === Infinity) return null
    return { minX, minY, maxX, maxY }
  }

  // ── private ─────────────────────────────────────────────────

  private clearInternal(): void {
    this.entityIds.clear()
    this.entitySelectors.clear()
    this._lastSelectedId = null
    this._lastSelectedSelector = null
  }

  private notify(): void {
    this._revision++
    this.cachedState = null
    const payload = this.buildEventPayload()
    this.eventBus.emit('selection.changed', payload)
    for (const fn of this.changeListeners) {
      fn()
    }
  }

  private buildEventPayload() {
    return {
      entityIds: this.selectedIds,
      hoveredEntityId: this._hoveredEntityId,
      lastSelectedId: this._lastSelectedId,
      selectors: this.selectors,
      hoveredSelector: this._hoveredSelector,
      lastSelectedSelector: this._lastSelectedSelector,
      mode: this._mode,
      origin: this._origin,
    }
  }
}
