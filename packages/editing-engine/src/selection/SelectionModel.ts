export interface SelectionSnapshot {
  selectedIds: ReadonlySet<string>
  lastSelectedId: string | null
  readonly size: number
}

export function createSelectionModel() {
  let _selectedIds = new Set<string>()
  let _lastSelectedId: string | null = null

  function snapshot(): SelectionSnapshot {
    const captured = new Set(_selectedIds)
    return {
      selectedIds: captured,
      lastSelectedId: _lastSelectedId,
      get size() { return captured.size },
    }
  }

  return {
    get selectedIds(): ReadonlySet<string> {
      return _selectedIds
    },

    get lastSelectedId(): string | null {
      return _lastSelectedId
    },

    get size(): number {
      return _selectedIds.size
    },

    get isEmpty(): boolean {
      return _selectedIds.size === 0
    },

    snapshot,

    select(id: string): void {
      _selectedIds = new Set([id])
      _lastSelectedId = id
    },

    deselect(id: string): void {
      const next = new Set(_selectedIds)
      next.delete(id)
      _selectedIds = next
      if (_lastSelectedId === id) {
        _lastSelectedId = next.size > 0 ? [...next][next.size - 1] : null
      }
    },

    toggle(id: string): void {
      if (_selectedIds.has(id)) {
        this.deselect(id)
      } else {
        const next = new Set(_selectedIds)
        next.add(id)
        _selectedIds = next
        _lastSelectedId = id
      }
    },

    selectMultiple(ids: string[]): void {
      _selectedIds = new Set(ids)
      _lastSelectedId = ids.length > 0 ? ids[ids.length - 1] : null
    },

    clear(): void {
      _selectedIds = new Set()
      _lastSelectedId = null
    },

    isSelected(id: string): boolean {
      return _selectedIds.has(id)
    },

    reset(): void {
      this.clear()
    },
  }
}

export type SelectionModel = ReturnType<typeof createSelectionModel>
