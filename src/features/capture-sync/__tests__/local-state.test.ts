import { describe, expect, it } from 'vitest'

import {
  CAPTURE_SYNC_DB_NAME,
  CAPTURE_SYNC_OBJECT_STORE,
  createLocalState,
  createMemoryCaptureSyncStateRepository,
} from '../local-state'

describe('Capture sync local state', () => {
  it('round-trips sync metadata without storing a Capture payload', async () => {
    const repository = createMemoryCaptureSyncStateRepository()
    const state = createLocalState('capture-1')

    await repository.put(state)

    expect(await repository.get('capture-1')).toEqual(state)
    expect(await repository.get('capture-1')).not.toHaveProperty('rawSamples')
  })

  it('uses a separate IndexedDB database and sync-state object store', () => {
    expect(CAPTURE_SYNC_DB_NAME).toBe('navi-capture-sync-v1')
    expect(CAPTURE_SYNC_OBJECT_STORE).toBe('sync-state')
  })

  it('clones state at the persistence boundary', async () => {
    const repository = createMemoryCaptureSyncStateRepository()
    const state = createLocalState('capture-1')
    await repository.put(state)

    state.status = 'syncing'

    expect((await repository.get('capture-1'))?.status).toBe('local')
  })
})
