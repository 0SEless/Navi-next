import { describe, it, expect, beforeEach } from 'vitest'
import { Viewport, BoundsLike } from './viewport'
import { DocumentEventBus } from './eventbus'

describe('Viewport', () => {
  let vp: Viewport
  let eventBus: DocumentEventBus

  beforeEach(() => {
    eventBus = new DocumentEventBus()
    vp = new Viewport(eventBus)
  })

  it('starts with default values', () => {
    expect(vp.zoom).toBe(15)
    expect(vp.center).toEqual({ lat: 0, lng: 0 })
    expect(vp.bearing).toBe(0)
    expect(vp.pitch).toBe(0)
  })

  it('setZoom clamps between 1 and 22', () => {
    vp.setZoom(0)
    expect(vp.zoom).toBe(1)
    vp.setZoom(30)
    expect(vp.zoom).toBe(22)
  })

  it('setPitch clamps between 0 and 60', () => {
    vp.setPitch(90)
    expect(vp.pitch).toBe(60)
  })

  it('setCenter updates center', () => {
    vp.setCenter({ lat: 10, lng: 20 })
    expect(vp.center).toEqual({ lat: 10, lng: 20 })
  })

  it('panTo also updates center', () => {
    vp.panTo({ lat: 33.42, lng: -111.93 })
    expect(vp.center).toEqual({ lat: 33.42, lng: -111.93 })
  })

  it('tracks active building/floor/layer', () => {
    vp.setActiveBuilding('bld-1')
    vp.setActiveFloor('flr-1')
    vp.setActiveLayer('buildings')
    expect(vp.activeBuildingId).toBe('bld-1')
    expect(vp.activeFloorId).toBe('flr-1')
    expect(vp.activeLayer).toBe('buildings')
  })

  it('emits viewport.changed on any change', () => {
    const events: any[] = []
    eventBus.on('viewport.changed', (s) => events.push(s))
    vp.setZoom(16)
    expect(events).toHaveLength(1)
    expect(events[0].zoom).toBe(16)
  })

  it('reset restores defaults', () => {
    vp.setZoom(18)
    vp.setCenter({ lat: 10, lng: 20 })
    vp.setActiveBuilding('bld-1')
    vp.reset()
    expect(vp.zoom).toBe(15)
    expect(vp.center).toEqual({ lat: 0, lng: 0 })
    expect(vp.activeBuildingId).toBeNull()
  })
})

describe('Viewport camera commands', () => {
  let viewport: Viewport
  let eventBus: DocumentEventBus

  beforeEach(() => {
    eventBus = new DocumentEventBus()
    viewport = new Viewport(eventBus)
  })

  it('enqueues a flyTo command', () => {
    viewport.flyTo({ lat: 10, lng: 20 }, { zoom: 18 })
    const cmd = viewport.consumePendingCommand()
    expect(cmd).not.toBeNull()
    expect(cmd!.type).toBe('flyTo')
    if (cmd!.type === 'flyTo') {
      expect(cmd!.center).toEqual({ lat: 10, lng: 20 })
      expect(cmd!.zoom).toBe(18)
    }
  })

  it('enqueues a fitBounds command', () => {
    const bounds: BoundsLike = { sw: { lat: 0, lng: 0 }, ne: { lat: 1, lng: 1 } }
    viewport.fitBounds(bounds, { padding: 50 })
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('fitBounds')
  })

  it('enqueues an easeTo command', () => {
    viewport.easeTo({ center: { lat: 5, lng: 5 }, zoom: 16 })
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('easeTo')
  })

  it('enqueues a reset command', () => {
    viewport.reset()
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('reset')
  })

  it('enqueues a zoomToSelection command', () => {
    viewport.zoomToSelection()
    const cmd = viewport.consumePendingCommand()
    expect(cmd!.type).toBe('zoomToSelection')
  })

  it('returns null when no command is pending', () => {
    expect(viewport.consumePendingCommand()).toBeNull()
  })

  it('clears command after consume', () => {
    viewport.flyTo({ lat: 0, lng: 0 })
    viewport.consumePendingCommand()
    expect(viewport.consumePendingCommand()).toBeNull()
  })
})
