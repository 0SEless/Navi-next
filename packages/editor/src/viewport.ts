import type { LatLng } from '@navi/core'
import { BaseEditorService } from './context'
import type { EditorServiceContext } from './context/service-registry'
import type { DocumentEventBus } from './eventbus'

export interface BoundsLike {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}

export type ViewportCommand =
  | { type: 'flyTo'; center: LatLng; zoom?: number; duration?: number }
  | { type: 'fitBounds'; bounds: BoundsLike; padding?: number; duration?: number }
  | { type: 'easeTo'; center?: LatLng; zoom?: number; bearing?: number; pitch?: number; duration?: number }
  | { type: 'reset' }
  | { type: 'zoomToSelection' }

export interface ViewportState {
  zoom: number
  center: LatLng
  bearing: number
  pitch: number
  activeBuildingId: string | null
  activeFloorId: string | null
  activeLayer: string | null
}

export class Viewport extends BaseEditorService {
  readonly id = 'viewport'
  readonly dependencies: readonly string[] = ['eventBus']

  private _zoom = 15
  private _center: LatLng = { lat: 0, lng: 0 }
  private _bearing = 0
  private _pitch = 0
  private _activeBuildingId: string | null = null
  private _activeFloorId: string | null = null
  private _activeLayer: string | null = null
  private eventBus!: DocumentEventBus
  private _pendingCommand: ViewportCommand | null = null
  private _revision = 0

  constructor(eventBus?: DocumentEventBus) {
    super()
    if (eventBus) this.eventBus = eventBus
  }

  async init(context: EditorServiceContext): Promise<void> {
    await super.init(context)
    this.eventBus = context.get('eventBus')
  }

  setZoom(zoom: number): void {
    this._zoom = Math.max(1, Math.min(22, zoom))
    this.emit()
  }

  setCenter(center: LatLng): void {
    this._center = { ...center }
    this.emit()
  }

  setBearing(bearing: number): void {
    this._bearing = bearing
    this.emit()
  }

  setPitch(pitch: number): void {
    this._pitch = Math.max(0, Math.min(60, pitch))
    this.emit()
  }

  panTo(center: LatLng): void {
    this._center = { ...center }
    this.emit()
  }

  setActiveBuilding(id: string | null): void {
    this._activeBuildingId = id
    this.emit()
  }

  setActiveFloor(id: string | null): void {
    this._activeFloorId = id
    this.emit()
  }

  setActiveLayer(layer: string | null): void {
    this._activeLayer = layer
    this.emit()
  }

  reset(): void {
    this._zoom = 15
    this._center = { lat: 0, lng: 0 }
    this._bearing = 0
    this._pitch = 0
    this._activeBuildingId = null
    this._activeFloorId = null
    this._activeLayer = null
    this._pendingCommand = { type: 'reset' }
    this._revision++
    this.emit()
  }

  get state(): ViewportState {
    return {
      zoom: this._zoom,
      center: { ...this._center },
      bearing: this._bearing,
      pitch: this._pitch,
      activeBuildingId: this._activeBuildingId,
      activeFloorId: this._activeFloorId,
      activeLayer: this._activeLayer,
    }
  }

  get zoom(): number { return this._zoom }
  get center(): LatLng { return { ...this._center } }
  get bearing(): number { return this._bearing }
  get pitch(): number { return this._pitch }
  get activeBuildingId(): string | null { return this._activeBuildingId }
  get activeFloorId(): string | null { return this._activeFloorId }
  get activeLayer(): string | null { return this._activeLayer }

  get revision(): number { return this._revision }

  flyTo(center: LatLng, opts?: { zoom?: number; duration?: number }): void {
    this._pendingCommand = { type: 'flyTo', center, ...opts }
    this._revision++
    this.emit()
  }

  fitBounds(bounds: BoundsLike, opts?: { padding?: number; duration?: number }): void {
    this._pendingCommand = { type: 'fitBounds', bounds, ...opts }
    this._revision++
    this.emit()
  }

  easeTo(opts: { center?: LatLng; zoom?: number; bearing?: number; pitch?: number; duration?: number }): void {
    this._pendingCommand = { type: 'easeTo', ...opts }
    this._revision++
    this.emit()
  }

  zoomToSelection(): void {
    this._pendingCommand = { type: 'zoomToSelection' }
    this._revision++
    this.emit()
  }

  consumePendingCommand(): ViewportCommand | null {
    const cmd = this._pendingCommand
    this._pendingCommand = null
    return cmd
  }

  private emit(): void {
    this.eventBus.emit('viewport.changed', this.state)
  }
}
