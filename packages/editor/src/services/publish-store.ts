export type PublishState = 'idle' | 'preparing' | 'validating' | 'compiling' | 'uploading' | 'success' | 'error'

export interface PublishResult {
  revision: number
  compiledGraphVersion: string
  campusId: string
  artifactCount: number
  nodeCount: number
  edgeCount: number
  startedAt: number
  finishedAt: number
}

export interface PublishSnapshot {
  version: number
  publishState: PublishState
  publishResult: PublishResult | null
  publishError: string | null
  currentStageStartedAt: number
  lastPublishedRevision: number
  lastPublishedAt: number
}

export class PublishStore {
  readonly dependencies: readonly string[] = []

  private _version = 0
  private _publishState: PublishState = 'idle'
  private _publishResult: PublishResult | null = null
  private _publishError: string | null = null
  private _currentStageStartedAt = 0
  private _lastPublishedRevision = 0
  private _lastPublishedAt = 0

  private listeners = new Set<() => void>()
  private cachedSnapshot: PublishSnapshot | null = null

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): PublishSnapshot {
    if (!this.cachedSnapshot || this.cachedSnapshot.version !== this._version) {
      this.cachedSnapshot = Object.freeze({
        version: this._version,
        publishState: this._publishState,
        publishResult: this._publishResult,
        publishError: this._publishError,
        currentStageStartedAt: this._currentStageStartedAt,
        lastPublishedRevision: this._lastPublishedRevision,
        lastPublishedAt: this._lastPublishedAt,
      })
    }
    return this.cachedSnapshot
  }

  updatePublishState(update: {
    publishState?: PublishState
    publishResult?: PublishResult | null
    publishError?: string | null
    currentStageStartedAt?: number
    lastPublishedRevision?: number
    lastPublishedAt?: number
  }): void {
    if (update.publishState !== undefined) this._publishState = update.publishState
    if (update.publishResult !== undefined) this._publishResult = update.publishResult
    if (update.publishError !== undefined) this._publishError = update.publishError
    if (update.currentStageStartedAt !== undefined) this._currentStageStartedAt = update.currentStageStartedAt
    if (update.lastPublishedRevision !== undefined) this._lastPublishedRevision = update.lastPublishedRevision
    if (update.lastPublishedAt !== undefined) this._lastPublishedAt = update.lastPublishedAt
    this._version++
    this.cachedSnapshot = null
    this.listeners.forEach((l) => l())
  }
}
