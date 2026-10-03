import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { LatLng } from '@navi/core'

export interface PlacePanoramaToolState {
  position: LatLng | null
}

export class PlacePanoramaTool implements Tool {
  readonly id = 'place-panorama'
  readonly label = 'Place Panorama'
  readonly cursor = 'crosshair'

  private position: LatLng | null = null

  get state(): PlacePanoramaToolState {
    return { position: this.position ? { ...this.position } : null }
  }

  onActivate(_ctx: ToolContext): void {
    this.position = null
  }

  onDeactivate(_ctx: ToolContext): void {
    this.position = null
  }

  onPointerDown(event: ToolPointerEvent, ctx: ToolContext): void {
    // Convert screen coordinates to lat/lng using the map
    const map = ctx.services.viewport?.getMap?.()
    if (!map) return

    const point = map.unproject([event.originalEvent.clientX, event.originalEvent.clientY])
    this.position = { lat: point.lat, lng: point.lng }

    // Create panorama at clicked position (outdoor, no buildingId)
    ctx.services.dispatcher.execute({
      id: 'panorama.create',
      label: 'Create Panorama',
      payload: {
        position: this.position,
        heading: 0,
        imageAssetId: '',
        buildingId: undefined, // Outdoor panorama
        floor: undefined,
        label: '',
      },
    })

    // Reset after placement
    this.position = null
  }

  onKeyDown(event: KeyboardEvent, _ctx: ToolContext): void {
    if (event.key === 'Escape') {
      this.position = null
    }
  }
}
