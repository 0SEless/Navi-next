import { BaseEditorService } from '../context/service-registry'

export class CurrentToolStore extends BaseEditorService {
  readonly id = 'toolRegistry'
  readonly dependencies: readonly string[] = []

  private _activeToolId: string | null = null
  private _listeners = new Set<() => void>()
  private _validToolIds: Set<string> | null = null

  get activeToolId(): string | null {
    return this._activeToolId
  }

  setValidToolIds(ids: Set<string>): void {
    this._validToolIds = ids
  }

  activate(id: string): void {
    if (this._validToolIds && !this._validToolIds.has(id)) {
      console.warn(`Tool "${id}" is not registered in the ToolRegistry`)
    }
    this._activeToolId = id
    this._notify()
  }

  deactivate(): void {
    this._activeToolId = null
    this._notify()
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  private _notify(): void {
    for (const fn of this._listeners) fn()
  }
}
