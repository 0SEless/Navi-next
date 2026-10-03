import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPublicStore } from '../public-store'
import { createMemoryCampusCacheRepository } from '@/features/public-campus/cache'

describe('Phase 7B public-store artifact contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('hydrates published door data into the runtime campus bundle', async () => {
    const door = {
      id: 'door-store',
      roomId: 'room-store',
      buildingId: 'building-store',
      floor: 0,
      position: { lat: 14, lng: 121 },
      width: 1.2,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        campusId: 'phase7b-campus',
        source: 'published_maps',
        revision: '7',
        buildings: [{
          id: 'building-store',
          name: 'Store Hall',
          floors: [{ level: 0, label: 'Ground Floor' }],
        }],
        components: [],
        doors: [door],
        nodes: [{
          id: 'node-store',
          label: 'Store Hall',
          type: 'room',
          position: { lat: 14, lng: 121 },
          floor: 0,
          buildingId: 'building-store',
        }],
        edges: [],
        boundary: null,
        artifacts: { metadata: { revision: '7' } },
      }), { status: 200 }),
    ))

    const store = createPublicStore({ cache: createMemoryCampusCacheRepository() })
    await store.getState().fetchCampusData('phase7b-campus')

    expect(store.getState().campusStatus).toBe('ready')
    expect(store.getState().campus?.doors).toEqual([door])
    expect(store.getState().campusData?.campusId).toBe('phase7b-campus')
  })
})
