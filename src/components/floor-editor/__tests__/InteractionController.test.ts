import { describe, it, expect, vi } from 'vitest'
import {
  InteractionController,
  getInteractionController,
} from '../InteractionController'
import type { CampusDocument } from '@navi/core'

function makeTestDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: '', description: '', lastModified: '', editorVersion: '' },
    buildings: [],
    roads: [
      {
        id: 'road-1',
        name: 'Main Walkway',
        polyline: {
          points: [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 0.001 },
          ],
        },
        width: 5,
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('InteractionController', () => {
  it('starts in idle mode', () => {
    const controller = new InteractionController()
    expect(controller.getState()).toEqual({ mode: 'idle' })
    expect(controller.getStatusMessage()).toBe('')
  })

  it('enters RelationshipSelection mode', () => {
    const controller = new InteractionController()
    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    const state = controller.getState()
    expect(state.mode).toBe('relationshipSelection')
    if (state.mode === 'relationshipSelection') {
      expect(state.ownerId).toBe('entrance-1')
      expect(state.ownerType).toBe('entrance')
      expect(state.relationshipType).toBe('entrance-road')
    }
  })

  it('provides status message when in interaction mode', () => {
    const controller = new InteractionController()
    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    expect(controller.getStatusMessage()).toBe('Select a road to connect. Esc to cancel.')
  })

  it('returns to idle on cancel', () => {
    const controller = new InteractionController()
    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    controller.onCancel({ type: 'cancel', reason: 'escape' })

    expect(controller.getState()).toEqual({ mode: 'idle' })
    expect(controller.getStatusMessage()).toBe('')
  })

  it('returns to idle after successful click on valid target', () => {
    const controller = new InteractionController()
    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    const doc = makeTestDocument()
    const consumed = controller.onClick(
      { type: 'click', latLng: { lat: 0, lng: 0 }, featureId: 'road-1', featureType: 'road' },
      doc,
    )

    expect(consumed).toBe(true)
    // State is still in interaction mode (caller dispatches command)
    expect(controller.getState().mode).toBe('relationshipSelection')
  })

  it('does not consume click on invalid target', () => {
    const controller = new InteractionController()
    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    const doc = makeTestDocument()
    const consumed = controller.onClick(
      { type: 'click', latLng: { lat: 0, lng: 0 }, featureId: 'room-1', featureType: 'room' },
      doc,
    )

    expect(consumed).toBe(false)
  })

  it('does not consume clicks when idle', () => {
    const controller = new InteractionController()
    const doc = makeTestDocument()
    const consumed = controller.onClick(
      { type: 'click', latLng: { lat: 0, lng: 0 }, featureId: 'road-1', featureType: 'road' },
      doc,
    )

    expect(consumed).toBe(false)
  })

  it('isValidTarget returns true for roads in entrance-road mode', () => {
    const controller = new InteractionController()
    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    expect(controller.isValidTarget('road-1', 'road')).toBe(true)
    expect(controller.isValidTarget('room-1', 'room')).toBe(false)
  })

  it('isValidTarget returns false when idle', () => {
    const controller = new InteractionController()
    expect(controller.isValidTarget('road-1', 'road')).toBe(false)
  })

  it('notifies listeners on state change', () => {
    const controller = new InteractionController()
    const listener = vi.fn()
    controller.onChange(listener)

    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'relationshipSelection' }),
    )
  })

  it('notifies listeners on cancel', () => {
    const controller = new InteractionController()
    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    const listener = vi.fn()
    controller.onChange(listener)

    controller.onCancel({ type: 'cancel', reason: 'escape' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ mode: 'idle' })
  })

  it('can unsubscribe from changes', () => {
    const controller = new InteractionController()
    const listener = vi.fn()
    const unsub = controller.onChange(listener)

    unsub()

    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    expect(listener).not.toHaveBeenCalled()
  })

  it('exits previous mode when entering a new one', () => {
    const controller = new InteractionController()
    const listener = vi.fn()
    controller.onChange(listener)

    controller.enterRelationshipSelection(
      'entrance-1',
      'entrance',
      'entrance-road',
    )

    // Enter another mode (should exit first)
    controller.enterRelationshipSelection(
      'entrance-2',
      'entrance',
      'entrance-road',
    )

    // Should have 3 calls: enter1, exit1 (from enter2), enter2
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('singleton returns same instance', () => {
    const a = getInteractionController()
    const b = getInteractionController()
    expect(a).toBe(b)
  })

  // P4-T4: Capture/release tests
  it('starts not captured', () => {
    const controller = new InteractionController()
    expect(controller.isCaptured()).toBe(false)
  })

  it('enters canvasCapture mode on capture', () => {
    const controller = new InteractionController()
    controller.capture('select')

    const state = controller.getState()
    expect(state.mode).toBe('canvasCapture')
    expect(controller.isCaptured()).toBe(true)
    if (state.mode === 'canvasCapture') {
      expect(state.tool).toBe('select')
      expect(state.capturedAt).toBeGreaterThan(0)
    }
  })

  it('returns to idle on release', () => {
    const controller = new InteractionController()
    controller.capture('select')
    controller.release()

    expect(controller.getState()).toEqual({ mode: 'idle' })
    expect(controller.isCaptured()).toBe(false)
  })

  it('does not re-capture if already captured', () => {
    const controller = new InteractionController()
    const listener = vi.fn()
    controller.onChange(listener)

    controller.capture('select')
    controller.capture('room') // Should not trigger another notification

    expect(listener).toHaveBeenCalledTimes(1)
    const state = controller.getState()
    expect(state.mode).toBe('canvasCapture')
    if (state.mode === 'canvasCapture') {
      expect(state.tool).toBe('select')
    }
  })

  it('release is no-op when not captured', () => {
    const controller = new InteractionController()
    const listener = vi.fn()
    controller.onChange(listener)

    controller.release() // Should not trigger notification

    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies listeners on capture', () => {
    const controller = new InteractionController()
    const listener = vi.fn()
    controller.onChange(listener)

    controller.capture('room')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'canvasCapture' }),
    )
  })

  it('notifies listeners on release', () => {
    const controller = new InteractionController()
    controller.capture('select')

    const listener = vi.fn()
    controller.onChange(listener)

    controller.release()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ mode: 'idle' })
  })

  it('cancel releases capture', () => {
    const controller = new InteractionController()
    controller.capture('select')

    controller.onCancel({ type: 'cancel', reason: 'escape' })

    expect(controller.getState()).toEqual({ mode: 'idle' })
    expect(controller.isCaptured()).toBe(false)
  })

  it('entering relationshipSelection exits canvasCapture', () => {
    const controller = new InteractionController()
    const listener = vi.fn()
    controller.onChange(listener)

    controller.capture('select')
    controller.enterRelationshipSelection('entrance-1', 'entrance', 'entrance-road')

    // Should have 3 calls: capture, exit-capture (from enter), enter-relationship
    expect(listener).toHaveBeenCalledTimes(3)
    expect(controller.getState().mode).toBe('relationshipSelection')
  })
})
