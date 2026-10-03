import { describe, it, expect } from 'vitest'
import { WorkflowStore } from '../workflow-store'
import type { ValidationResult } from '../workflow-store'

describe('WorkflowStore', () => {
  it('starts with empty snapshot', () => {
    const store = new WorkflowStore()
    const snap = store.getSnapshot()
    expect(snap.version).toBe(0)
    expect(snap.lastValidation).toBeNull()
    expect(snap.lastCompile).toBeNull()
    expect(snap.lastSave).toBeNull()
    expect(snap.lastPublish).toBeNull()
    expect(snap.syncStatus).toBe('idle')
    expect(snap.lastSaveVersion).toBe(0)
  })

  it('subscribe/notify: listener fires on mutation', () => {
    const store = new WorkflowStore()
    let called = 0
    const unsub = store.subscribe(() => { called++ })
    store.setValidation({ passed: 1, failed: 0, errors: [], timestamp: 100 })
    expect(called).toBe(1)
    unsub()
  })

  it('getSnapshot returns frozen object', () => {
    const store = new WorkflowStore()
    expect(Object.isFrozen(store.getSnapshot())).toBe(true)
  })

  it('getSnapshot returns stable reference when version unchanged', () => {
    const store = new WorkflowStore()
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    expect(a).toBe(b)
  })

  it('getSnapshot returns new reference after mutation', () => {
    const store = new WorkflowStore()
    const a = store.getSnapshot()
    store.setValidation({ passed: 1, failed: 0, errors: [], timestamp: 100 })
    const b = store.getSnapshot()
    expect(a).not.toBe(b)
    expect(b.version).toBe(1)
  })

  it('setValidation updates lastValidation in snapshot', () => {
    const store = new WorkflowStore()
    const result: ValidationResult = { passed: 5, failed: 2, errors: ['err1'], timestamp: 200 }
    store.setValidation(result)
    expect(store.getSnapshot().lastValidation).toEqual(result)
  })

  it('setCompile updates lastCompile in snapshot', () => {
    const store = new WorkflowStore()
    store.setCompile({ status: 'success', timestamp: 300, artifacts: { navigationGraph: null, searchIndex: null, poiData: null, buildingIndex: null } })
    expect(store.getSnapshot().lastCompile?.status).toBe('success')
  })

  it('setSave updates lastSave in snapshot', () => {
    const store = new WorkflowStore()
    store.setSave(400, 'manual')
    expect(store.getSnapshot().lastSave).toEqual({ timestamp: 400, reason: 'manual' })
  })

  it('setSave with autosave reason', () => {
    const store = new WorkflowStore()
    store.setSave(500, 'autosave')
    expect(store.getSnapshot().lastSave?.reason).toBe('autosave')
  })

  it('setPublish updates lastPublish in snapshot', () => {
    const store = new WorkflowStore()
    store.setPublish(600)
    expect(store.getSnapshot().lastPublish).toEqual({ timestamp: 600 })
  })

  it('setSyncStatus updates syncStatus in snapshot', () => {
    const store = new WorkflowStore()
    store.setSyncStatus('syncing')
    expect(store.getSnapshot().syncStatus).toBe('syncing')
    store.setSyncStatus('success')
    expect(store.getSnapshot().syncStatus).toBe('success')
  })

  it('setLastSaveVersion updates lastSaveVersion', () => {
    const store = new WorkflowStore()
    store.setLastSaveVersion(42)
    expect(store.getSnapshot().lastSaveVersion).toBe(42)
  })

  it('multiple mutations increment version', () => {
    const store = new WorkflowStore()
    store.setValidation({ passed: 1, failed: 0, errors: [], timestamp: 100 })
    store.setCompile({ status: 'success', timestamp: 200, artifacts: { navigationGraph: null, searchIndex: null, poiData: null, buildingIndex: null } })
    store.setSave(300, 'manual')
    store.setPublish(400)
    expect(store.getSnapshot().version).toBe(4)
  })

  it('unsubscribe stops listener from firing', () => {
    const store = new WorkflowStore()
    let called = 0
    const unsub = store.subscribe(() => { called++ })
    unsub()
    store.setValidation({ passed: 1, failed: 0, errors: [], timestamp: 100 })
    expect(called).toBe(0)
  })

  it('multiple subscribers all notified', () => {
    const store = new WorkflowStore()
    let a = 0, b = 0
    store.subscribe(() => { a++ })
    store.subscribe(() => { b++ })
    store.setValidation({ passed: 1, failed: 0, errors: [], timestamp: 100 })
    expect(a).toBe(1)
    expect(b).toBe(1)
  })
})
