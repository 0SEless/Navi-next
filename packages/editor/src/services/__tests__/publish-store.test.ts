import { describe, it, expect } from 'vitest'
import { PublishStore } from '../publish-store'

describe('PublishStore', () => {
  it('initial snapshot is idle with no result', () => {
    const store = new PublishStore()
    const snap = store.getSnapshot()
    expect(snap.publishState).toBe('idle')
    expect(snap.publishResult).toBeNull()
    expect(snap.publishError).toBeNull()
    expect(snap.currentStageStartedAt).toBe(0)
    expect(snap.lastPublishedRevision).toBe(0)
    expect(snap.lastPublishedAt).toBe(0)
  })

  it('updatePublishState atomically updates fields', () => {
    const store = new PublishStore()
    store.updatePublishState({ publishState: 'preparing', currentStageStartedAt: 100 })
    const snap = store.getSnapshot()
    expect(snap.publishState).toBe('preparing')
    expect(snap.currentStageStartedAt).toBe(100)
  })

  it('notifies subscribers on update', () => {
    const store = new PublishStore()
    let called = 0
    const unsub = store.subscribe(() => { called++ })
    store.updatePublishState({ publishState: 'preparing' })
    expect(called).toBe(1)
    unsub()
    store.updatePublishState({ publishState: 'idle' })
    expect(called).toBe(1)
  })

  it('returns frozen immutable snapshot', () => {
    const store = new PublishStore()
    const snap = store.getSnapshot()
    expect(Object.isFrozen(snap)).toBe(true)
  })

  it('version increments on each update', () => {
    const store = new PublishStore()
    const v1 = store.getSnapshot().version
    store.updatePublishState({ publishState: 'preparing' })
    const v2 = store.getSnapshot().version
    expect(v2).toBe(v1 + 1)
  })

  it('cached snapshot is stable between updates', () => {
    const store = new PublishStore()
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    expect(a).toBe(b)
  })
})
