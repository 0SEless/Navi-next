import { describe, expect, it } from 'vitest'
import { getSaveStatusModel } from '../save-status-model'

const base = {
  saveState: 'saved' as const,
  syncStatus: 'synced' as const,
  syncError: null,
}

describe('Studio save status model', () => {
  it('shows the administrator-facing conflict contract and keeps raw text as diagnostic', () => {
    const raw =
      'The server has a different version of this map (2026-09-13T09:12:40.365798Z). Your unsynced local changes are preserved. Use "Load server version" to replace them, or reSync({ force: true }) to overwrite the server.'
    const model = getSaveStatusModel({
      ...base,
      syncStatus: 'conflict',
      syncError: raw,
    })

    expect(model.label).toBe('Changes not synced')
    expect(model.detail).toBe(
      'This device contains changes that could not be synchronized because the server version changed. Your local work is preserved.'
    )
    expect(model.showRecoveryActions).toBe(true)
    expect(model.diagnostic).toBe(raw)
    expect(model.detail).not.toContain('reSync')
    expect(model.detail).not.toContain('2026-09-13T')
  })

  it('never maps a pending sync to all changes saved', () => {
    const model = getSaveStatusModel({
      ...base,
      syncStatus: 'syncing',
    })

    expect(model.label).toBe('Saving...')
    expect(model.label).not.toBe('All changes saved')
    expect(model.diagnostic).toBeNull()

    expect(getSaveStatusModel({ ...base, saveState: 'saving' }).label).toBe('Saving...')
    expect(getSaveStatusModel({ ...base, saveState: 'dirty-while-saving' }).label).toBe('Saving...')
  })

  it('surfaces a bounded automatic retry instead of claiming a normal save is still running', () => {
    const model = getSaveStatusModel({
      ...base,
      syncStatus: 'syncing',
      syncError: 'Save failed — retrying automatically',
    })

    expect(model.label).toBe('Save failed — retrying automatically')
    expect(model.color).toBe('#d97706')
    expect(model.showRecoveryActions).toBe(false)
    expect(model.diagnostic).toBe('Save failed — retrying automatically')
  })

  it('shows a neutral checking state while server freshness is unresolved', () => {
    const model = getSaveStatusModel({
      ...base,
      syncStatus: 'checking',
      saveState: 'dirty',
    })

    expect(model.label).toBe('Checking server…')
    expect(model.color).toBe('#64748b')
    expect(model.detail).toBeNull()
    expect(model.showRecoveryActions).toBe(false)
    expect(model.diagnostic).toBeNull()
    expect(model.label).not.toBe('All changes saved')
  })

  it('keeps conflict and error ahead of checking, and checking ahead of saving', () => {
    expect(getSaveStatusModel({
      ...base,
      syncStatus: 'conflict',
      syncError: 'conflict',
    }).label).toBe('Changes not synced')

    expect(getSaveStatusModel({
      ...base,
      syncStatus: 'error',
      syncError: 'boom',
    }).label).toBe('Save failed — changes preserved')

    expect(getSaveStatusModel({
      ...base,
      saveState: 'saving',
      syncStatus: 'checking',
    }).label).toBe('Checking server…')
  })

  it('treats an offline sync failure as saved on this device', () => {
    const model = getSaveStatusModel({
      ...base,
      syncStatus: 'error',
      syncError: 'Offline — changes saved locally. Will retry when back online.',
    })

    expect(model.label).toBe('Saved on this device')
    expect(model.detail).toBe(
      'You appear to be offline. Your work is saved on this device and will sync automatically.'
    )
    expect(model.showRecoveryActions).toBe(false)
    expect(model.diagnostic).toBe('Offline — changes saved locally. Will retry when back online.')
  })

  it('keeps recovery for non-offline sync failures with a human-readable detail', () => {
    const raw = 'POST /api/graph failed with 500'
    const model = getSaveStatusModel({
      ...base,
      syncStatus: 'error',
      syncError: raw,
    })

    expect(model.label).toBe('Save failed — changes preserved')
    expect(model.detail).toBe(
      'Saving failed. Your local changes are preserved; retry when the server is reachable.'
    )
    expect(model.showRecoveryActions).toBe(true)
    expect(model.diagnostic).toBe(raw)
    expect(model.detail).not.toContain('POST')
  })

  it('only reports all changes saved after workflow and graph sync succeed', () => {
    expect(getSaveStatusModel(base).label).toBe('All changes saved')
    expect(getSaveStatusModel({
      ...base,
      syncStatus: 'idle',
    }).label).toBe('Sync pending...')
    expect(getSaveStatusModel({
      ...base,
      saveState: 'dirty',
    }).label).toBe('Unsaved changes')
  })

  it('keeps raw producer text out of non-error details', () => {
    const model = getSaveStatusModel({
      ...base,
      syncStatus: 'synced',
      saveError: 'workflow write aborted',
    })

    expect(model.detail).toBeNull()
    expect(model.diagnostic).toBeNull()
  })
})
