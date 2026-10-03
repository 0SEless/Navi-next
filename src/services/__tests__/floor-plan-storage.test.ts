import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase-client', () => ({ createClient }))
vi.mock('@navi/editor', () => ({
  needsRasterization: () => false,
  rasterizePdfToPng: vi.fn(),
}))

import { deleteFloorPlanImage } from '../floor-plan-storage'

describe('floor-plan storage cleanup ownership', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  beforeEach(() => {
    createClient.mockReset()
  })

  afterEach(() => {
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
  })

  it('does not attempt destructive cleanup without a matching managed scope', async () => {
    await deleteFloorPlanImage('https://external.example/floor-plans/map/building/floor-0-old.png')
    await deleteFloorPlanImage('https://external.example/floor-plans/map/building/floor-0-old.png', {
      supabaseUrl: 'https://storage.example',
      mapId: 'map',
      buildingId: 'building',
      floorLevel: 0,
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('allows cleanup only for the exact managed floor prefix', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null })
    createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example'

    await deleteFloorPlanImage('https://storage.example/storage/v1/object/public/floor-plans/map/building/floor-0-old.png', {
      supabaseUrl: 'https://storage.example',
      mapId: 'map',
      buildingId: 'building',
      floorLevel: 0,
    })

    expect(remove).toHaveBeenCalledWith(['map/building/floor-0-old.png'])
  })
})
