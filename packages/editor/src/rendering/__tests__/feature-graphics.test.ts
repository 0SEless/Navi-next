import { describe, it, expect } from 'vitest'
import { generateStairGraphicsLatLng, generateElevatorGraphicsLatLng } from '../feature-graphics'
import { buildStairGeoJSON } from '@/components/map/layers/StaircaseLayer'
import { buildElevatorGeoJSON } from '@/components/map/layers/ElevatorLayer'


describe('P4 Feature Visual Graphics', () => {
  const quadPoly = [
    { lat: 33.4200, lng: -111.9300 },
    { lat: 33.4200, lng: -111.9280 },
    { lat: 33.4210, lng: -111.9280 },
    { lat: 33.4210, lng: -111.9300 },
  ]

  it('generates parallel stair tread lines and directional walk arrow from polygon', () => {
    const graphics = generateStairGraphicsLatLng(quadPoly, 8)

    expect(graphics.outline).toHaveLength(4)
    expect(graphics.treads).toHaveLength(7) // 8 steps -> 7 interior tread lines
    for (const tread of graphics.treads) {
      expect(tread).toHaveLength(2)
      expect(tread[0].lng).toBeLessThan(tread[1].lng)
    }

    // Directional walk arrow
    expect(graphics.arrow.length).toBeGreaterThanOrEqual(4)
  })

  it('generates elevator shaft, cabin inset box, and door marker double-lines', () => {
    const graphics = generateElevatorGraphicsLatLng(quadPoly, 0.8)

    expect(graphics.shaftOutline).toHaveLength(4)
    expect(graphics.cabinOutline).toHaveLength(5) // 4 vertices + closing vertex
    expect(graphics.doorLines).toHaveLength(2) // 2 door segment markers
  })

  it('buildStairGeoJSON produces rich architectural GeoJSON features for map layers', () => {
    const stairs = [
      {
        id: 'stair-1',
        name: 'Main Stairs',
        buildingId: 'bld-1',
        floor: 0,
        position: { lat: 33.4205, lng: -111.9290 },
        polygon: quadPoly,
      },
    ]

    const geo = buildStairGeoJSON(stairs)
    expect(geo.features.length).toBeGreaterThanOrEqual(3)

    const bodyFeature = geo.features.find((f) => f.properties?.kind === 'body')
    expect(bodyFeature).toBeDefined()
    expect(bodyFeature!.geometry.type).toBe('Polygon')

    const treadFeatures = geo.features.filter((f) => f.properties?.kind === 'tread')
    expect(treadFeatures.length).toBeGreaterThan(0)

    const arrowFeature = geo.features.find((f) => f.properties?.kind === 'arrow')
    expect(arrowFeature).toBeDefined()

    const symbolFeature = geo.features.find((f) => f.properties?.kind === 'symbol')
    expect(symbolFeature).toBeDefined()
  })

  it('buildElevatorGeoJSON produces shaft, cabin, and door GeoJSON features for map layers', () => {
    const elevators = [
      {
        id: 'elev-1',
        name: 'Main Elevator',
        buildingId: 'bld-1',
        floor: 0,
        position: { lat: 33.4205, lng: -111.9290 },
        polygon: quadPoly,
      },
    ]

    const geo = buildElevatorGeoJSON(elevators)
    expect(geo.features.length).toBeGreaterThanOrEqual(3)

    const shaftFeature = geo.features.find((f) => f.properties?.kind === 'shaft')
    expect(shaftFeature).toBeDefined()
    expect(shaftFeature!.geometry.type).toBe('Polygon')

    const cabinFeature = geo.features.find((f) => f.properties?.kind === 'cabin')
    expect(cabinFeature).toBeDefined()

    const doorFeatures = geo.features.filter((f) => f.properties?.kind === 'door')
    expect(doorFeatures).toHaveLength(2)

    const symbolFeature = geo.features.find((f) => f.properties?.kind === 'symbol')
    expect(symbolFeature).toBeDefined()
  })
})
