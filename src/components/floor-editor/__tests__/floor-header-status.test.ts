import { describe, expect, it } from 'vitest'
import { deriveFloorHeaderStatus } from '@/hooks/floor-graph-selectors'

/**
 * The floor header is the primary authoring surface; its badge must follow the
 * same confirmed-sync contract as the studio SaveStatus.
 */
describe('deriveFloorHeaderStatus', () => {
  it('reports saved only when the server-confirmed graph sync and a clean document agree', () => {
    expect(deriveFloorHeaderStatus('synced', 'saved')).toBe('saved')
    expect(deriveFloorHeaderStatus('synced', 'idle')).toBe('saved')
    expect(deriveFloorHeaderStatus('synced', null)).toBe('saved')
    expect(deriveFloorHeaderStatus('synced', undefined)).toBe('saved')
  })

  it('never reports saved for an unconfirmed or dirty graph sync', () => {
    expect(deriveFloorHeaderStatus('idle', 'saved')).toBe('unsaved')
    expect(deriveFloorHeaderStatus('idle', 'idle')).toBe('unsaved')
    expect(deriveFloorHeaderStatus('syncing', 'saved')).toBe('saving')
    expect(deriveFloorHeaderStatus('synced', 'saving')).toBe('saving')
    expect(deriveFloorHeaderStatus('synced', 'dirty')).toBe('unsaved')
    expect(deriveFloorHeaderStatus('synced', 'dirty-while-saving')).toBe('unsaved')
  })

  it('gives conflict and error precedence over any clean state', () => {
    expect(deriveFloorHeaderStatus('conflict', 'saved')).toBe('conflict')
    expect(deriveFloorHeaderStatus('conflict', 'dirty')).toBe('conflict')
    expect(deriveFloorHeaderStatus('error', 'saved')).toBe('error')
    expect(deriveFloorHeaderStatus('error', 'idle')).toBe('error')
  })

  it('keeps checking while freshness is unresolved, ahead of saving and dirty', () => {
    expect(deriveFloorHeaderStatus('checking', 'saved')).toBe('checking')
    expect(deriveFloorHeaderStatus('checking', 'dirty')).toBe('checking')
    expect(deriveFloorHeaderStatus('checking', 'dirty-while-saving')).toBe('checking')
    expect(deriveFloorHeaderStatus('checking', 'saving')).toBe('checking')
  })

  it('treats unknown or missing states as unsaved', () => {
    expect(deriveFloorHeaderStatus(undefined, undefined)).toBe('unsaved')
    expect(deriveFloorHeaderStatus(null, 'error')).toBe('unsaved')
    expect(deriveFloorHeaderStatus('idle', 'error')).toBe('unsaved')
  })
})
