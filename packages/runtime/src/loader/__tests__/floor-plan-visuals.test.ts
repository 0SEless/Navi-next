import { describe, expect, it } from 'vitest'
import type { BuildingIndexFile } from '@navi/core'
import { toRuntimeBuildings } from '../runtime-converter'

describe('runtime floor-plan visual metadata', () => {
  it('keeps optional published alignment metadata while retaining legacy URLs', () => {
    const file: BuildingIndexFile = {
      schemaVersion: '1.0.0',
      buildings: [{
        id: 'b1',
        name: 'Building',
        code: 'B1',
        position: { lat: 14, lng: 121 },
        floors: [{ level: 0, label: 'GF', elevation: 0, nodeIds: [] }],
        entrances: [],
        floorPlanUrls: { 0: 'plan.png' },
        floorPlanVisuals: {
          0: {
            imageUrl: 'plan.png',
            alignment: { scaleX: 1.2, scaleY: 0.8, rotation: 12, offset: { x: 2, y: -1 }, opacity: 0.65, locked: true },
          },
        },
      }],
    }

    const runtime = toRuntimeBuildings(file)

    expect(runtime.buildings[0].floorPlanUrls).toEqual({ 0: 'plan.png' })
    expect(runtime.buildings[0].floorPlanVisuals?.[0]).toEqual(file.buildings[0].floorPlanVisuals?.[0])
  })
})
