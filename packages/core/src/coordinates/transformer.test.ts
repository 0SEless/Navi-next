import { describe, it, expect, beforeEach } from 'vitest'
import { CoordinateTransformer } from './transformer'
import { wgs84ToWebMercator } from './crs'

describe('CoordinateTransformer', () => {
  let tf: CoordinateTransformer

  beforeEach(() => {
    tf = new CoordinateTransformer()
    tf.registerBuilding({
      buildingId: 'bld-1',
      origin: { lat: 33.42, lng: -111.93 },
      rotation: 0,
    })
  })

  it('worldToCampus → campusToWorld round-trip', () => {
    const original = { lat: 33.425, lng: -111.925 }
    const campus = tf.worldToCampus(original)
    const back = tf.campusToWorld(campus.x, campus.y)
    expect(back.lat).toBeCloseTo(original.lat, 8)
    expect(back.lng).toBeCloseTo(original.lng, 8)
  })

  it('world → building-local → world round-trip', () => {
    const world = { lat: 33.421, lng: -111.929 }
    const local = tf.worldToBuildingLocal(world, 'bld-1')
    expect(local).not.toBeNull()
    const back = tf.buildingLocalToWorld(local!, 'bld-1')
    expect(back!.lat).toBeCloseTo(world.lat, 8)
    expect(back!.lng).toBeCloseTo(world.lng, 8)
  })

  it('building-local origin is at building origin', () => {
    const local = tf.worldToBuildingLocal({ lat: 33.42, lng: -111.93 }, 'bld-1')
    expect(local!.x).toBeCloseTo(0, 3)
    expect(local!.y).toBeCloseTo(0, 3)
  })

  it('returns null for unknown building', () => {
    expect(tf.worldToBuildingLocal({ lat: 0, lng: 0 }, 'unknown')).toBeNull()
    expect(tf.buildingLocalToWorld({ x: 0, y: 0 }, 'unknown')).toBeNull()
  })

  it('screenToWorld → worldToScreen round-trip', () => {
    const camera = {
      center: { lat: 33.42, lng: -111.93 },
      zoom: 18,
      bearing: 0,
      pitch: 0,
      viewportWidth: 800,
      viewportHeight: 600,
    }
    const world = { lat: 33.421, lng: -111.929 }
    const screen = tf.worldToScreen(world, camera)
    const back = tf.screenToWorld(screen.x, screen.y, camera)
    expect(back.lat).toBeCloseTo(world.lat, 5)
    expect(back.lng).toBeCloseTo(world.lng, 5)
  })

  // ── P1-T1: per-floor offset & rotation (floor-local → building-local step) ──

  it('floor-local → building-local applies a nonzero floor offset exactly', () => {
    tf.registerFloor('bld-1', 0, { offset: { x: 5, y: -3 }, rotation: 0 })
    const bl = tf.floorLocalToBuildingLocal({ x: 1, y: 2 }, 'bld-1', 0)
    expect(bl).toEqual({ x: 6, y: -1 })
  })

  it('building-local → floor-local inverts the floor offset exactly', () => {
    tf.registerFloor('bld-1', 0, { offset: { x: 5, y: -3 }, rotation: 0 })
    const fl = tf.buildingLocalToFloorLocal({ x: 6, y: -1 }, 'bld-1', 0)
    expect(fl).toEqual({ x: 1, y: 2 })
  })

  it('floor-local ↔ building-local round-trip with offset and rotation', () => {
    tf.registerFloor('bld-1', 0, { offset: { x: 12, y: 7 }, rotation: 30 })
    const p = { x: 3.5, y: -2.25 }
    const bl = tf.floorLocalToBuildingLocal(p, 'bld-1', 0)!
    const back = tf.buildingLocalToFloorLocal(bl, 'bld-1', 0)!
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('floor-local → world → floor-local round-trip through the full chain', () => {
    // R3.1: floor-local → + floor.offset → building-local → buildingLocalToWorld → LatLng
    tf.registerFloor('bld-1', 0, { offset: { x: 20, y: -10 }, rotation: 0 })
    const p = { x: 4, y: 6 }
    const world = tf.floorLocalToWorld(p, 'bld-1', 0)!
    expect(world).not.toBeNull()
    const back = tf.worldToFloorLocal(world, 'bld-1', 0)!
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('nonzero floor rotation rotates floor-local geometry (45°)', () => {
    // R3.5: local→world correct for nonzero floor rotation, both directions.
    tf.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 45 })
    const bl = tf.floorLocalToBuildingLocal({ x: 1, y: 0 }, 'bld-1', 0)!
    const sqrt2o2 = Math.SQRT1_2
    expect(bl.x).toBeCloseTo(sqrt2o2, 6)
    expect(bl.y).toBeCloseTo(sqrt2o2, 6)
    // inverse
    const back = tf.buildingLocalToFloorLocal(bl, 'bld-1', 0)!
    expect(back.x).toBeCloseTo(1, 6)
    expect(back.y).toBeCloseTo(0, 6)
  })

  it('building rotation composes with floor offset through world (45°)', () => {
    // R3.5: local→world conversion correct for nonzero building rotation.
    tf.registerBuilding({
      buildingId: 'bld-rot',
      origin: { lat: 33.42, lng: -111.93 },
      rotation: 45,
    })
    tf.registerFloor('bld-rot', 0, { offset: { x: 0, y: 0 }, rotation: 0 })
    tf.registerBuilding({
      buildingId: 'bld-flat',
      origin: { lat: 33.42, lng: -111.93 },
      rotation: 0,
    })
    const p = { x: 10, y: 0 }
    const world = tf.floorLocalToWorld(p, 'bld-rot', 0)!
    const back = tf.worldToFloorLocal(world, 'bld-rot', 0)!
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
    // The world point must differ from the unrotated case (rotation actually applied).
    const worldFlat = tf.floorLocalToWorld(p, 'bld-flat', 0)!
    expect(worldFlat.lng).not.toBeCloseTo(world.lng, 8)
  })

  it('unknown floor level falls back to identity (legacy docs, no migration prompt)', () => {
    // R2.1: existing documents without the fields behave as {x:0,y:0} / 0.
    const bl = tf.floorLocalToBuildingLocal({ x: 3, y: 4 }, 'bld-1', 99)
    expect(bl).toEqual({ x: 3, y: 4 })
    const fl = tf.buildingLocalToFloorLocal({ x: 3, y: 4 }, 'bld-1', 99)
    expect(fl).toEqual({ x: 3, y: 4 })
  })

  it('floor-local methods return null for unknown building', () => {
    expect(tf.floorLocalToBuildingLocal({ x: 0, y: 0 }, 'unknown', 0)).toBeNull()
    expect(tf.buildingLocalToFloorLocal({ x: 0, y: 0 }, 'unknown', 0)).toBeNull()
    expect(tf.floorLocalToWorld({ x: 0, y: 0 }, 'unknown', 0)).toBeNull()
    expect(tf.worldToFloorLocal({ lat: 0, lng: 0 }, 'unknown', 0)).toBeNull()
  })

  // ── P1-T2: coordinate chain round-trip & QR trace regression ──

  it('multi-floor round-trip preserves floor-local within 1e-6 m (distinct offsets + rotated building)', () => {
    // Distinct per-floor offsets on a rotated building: each floor must
    // round-trip independently through the full chain (R3.1 / D4).
    tf.registerBuilding({
      buildingId: 'bld-multi',
      origin: { lat: 33.42, lng: -111.93 },
      rotation: 15,
    })
    const floors = [
      { level: 0, offset: { x: 0, y: 0 } },
      { level: 1, offset: { x: 12.5, y: -8.25 } },
      { level: 2, offset: { x: -4, y: 30.75 } },
    ]
    for (const f of floors) {
      tf.registerFloor('bld-multi', f.level, { offset: f.offset, rotation: 0 })
    }
    const points = [
      { x: 0, y: 0 },
      { x: 24.3, y: 11.8 },
      { x: -37.2, y: 51.5 },
      { x: 100, y: -100 },
    ]
    for (const f of floors) {
      for (const p of points) {
        const world = tf.floorLocalToWorld(p, 'bld-multi', f.level)!
        const back = tf.worldToFloorLocal(world, 'bld-multi', f.level)!
        expect(back.x).toBeCloseTo(p.x, 6)
        expect(back.y).toBeCloseTo(p.y, 6)
      }
    }
  })

  it('QR trace: floor-local (24.3, 11.8) on Floor 2 resolves to the documented world position', () => {
    // Audit 04-coordinates-indoor-outdoor.md (QR-02): Jolo campus origin
    // (lat=11.8195, lng=122.0922), floor 2 aligned (offset +0), building
    // rotation 0 → documented world ≈ {lat: 11.819606, lng: 122.092418}.
    // Tolerance 1e-5° ≈ 1 m (audit used rounded intermediates).
    tf.registerBuilding({
      buildingId: 'jolo-a',
      origin: { lat: 11.8195, lng: 122.0922 },
      rotation: 0,
    })
    tf.registerFloor('jolo-a', 2, { offset: { x: 0, y: 0 }, rotation: 0 })

    const world = tf.floorLocalToWorld({ x: 24.3, y: 11.8 }, 'jolo-a', 2)!
    expect(world.lat).toBeCloseTo(11.819606, 5)
    expect(world.lng).toBeCloseTo(122.092418, 5)

    // Inverse of the chain's exact world point round-trips to (24.3, 11.8).
    const back = tf.worldToFloorLocal(world, 'jolo-a', 2)!
    expect(back.x).toBeCloseTo(24.3, 6)
    expect(back.y).toBeCloseTo(11.8, 6)

    // Inverse of the DOCUMENTED (rounded) world position lands within ~0.5 m
    // of the original floor-local point (audit used rounded intermediates).
    const backDoc = tf.worldToFloorLocal({ lat: 11.819606, lng: 122.092418 }, 'jolo-a', 2)!
    expect(Math.abs(backDoc.x - 24.3)).toBeLessThan(0.5)
    expect(Math.abs(backDoc.y - 11.8)).toBeLessThan(0.5)
  })

  it('QR trace with nonzero floor offset: offset is added before world conversion and inverted on return', () => {
    // Same QR-02 point but floor 2 offset {x: 5, y: 0} (audit's "+5 if offset"
    // variant): floor-local (24.3, 11.8) → building-local (29.3, 11.8) → world.
    tf.registerBuilding({
      buildingId: 'jolo-b',
      origin: { lat: 11.8195, lng: 122.0922 },
      rotation: 0,
    })
    tf.registerFloor('jolo-b', 2, { offset: { x: 5, y: 0 }, rotation: 0 })

    const bl = tf.floorLocalToBuildingLocal({ x: 24.3, y: 11.8 }, 'jolo-b', 2)!
    expect(bl).toEqual({ x: 29.3, y: 11.8 })

    const world = tf.floorLocalToWorld({ x: 24.3, y: 11.8 }, 'jolo-b', 2)!
    expect(world.lat).toBeCloseTo(11.819603754, 6)
    expect(world.lng).toBeCloseTo(122.092463206, 6)

    const back = tf.worldToFloorLocal(world, 'jolo-b', 2)!
    expect(back.x).toBeCloseTo(24.3, 6)
    expect(back.y).toBeCloseTo(11.8, 6)
  })

  it('zero/default floor offset behaves exactly like building-local today', () => {
    // A floor registered with offset {0,0} must produce identical world
    // coordinates to the building-local path (no double-shift, no drift).
    tf.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })
    const p = { x: 24.3, y: 11.8 }
    const viaFloor = tf.floorLocalToWorld(p, 'bld-1', 0)!
    const viaBuilding = tf.buildingLocalToWorld(p, 'bld-1')!
    expect(viaFloor.lat).toBeCloseTo(viaBuilding.lat, 9)
    expect(viaFloor.lng).toBeCloseTo(viaBuilding.lng, 9)

    // Unregistered floor (legacy docs): identity step → same as building-local.
    const unreg = tf.floorLocalToWorld(p, 'bld-1', 99)!
    expect(unreg.lat).toBeCloseTo(viaBuilding.lat, 9)
    expect(unreg.lng).toBeCloseTo(viaBuilding.lng, 9)
  })

  it('floor identity preserved: same world point maps back per-floor, no cross-floor contamination', () => {
    // Two floors with different offsets: the SAME world point must convert to
    // DIFFERENT floor-local coordinates, each consistent with its own floor.
    tf.registerBuilding({
      buildingId: 'bld-floors',
      origin: { lat: 33.42, lng: -111.93 },
      rotation: 0,
    })
    tf.registerFloor('bld-floors', 0, { offset: { x: 0, y: 0 }, rotation: 0 })
    tf.registerFloor('bld-floors', 1, { offset: { x: 10, y: -5 }, rotation: 0 })

    const world = tf.floorLocalToWorld({ x: 24.3, y: 11.8 }, 'bld-floors', 1)!
    const backF1 = tf.worldToFloorLocal(world, 'bld-floors', 1)!
    const backF0 = tf.worldToFloorLocal(world, 'bld-floors', 0)!

    // Correct floor round-trips to the original point…
    expect(backF1.x).toBeCloseTo(24.3, 6)
    expect(backF1.y).toBeCloseTo(11.8, 6)
    // …and the other floor yields a DIFFERENT local position (its own chain):
    // floor 0 offset is (0,0), so it sees the raw building-local (34.3, 6.8).
    expect(backF0.x).toBeCloseTo(34.3, 6)
    expect(backF0.y).toBeCloseTo(6.8, 6)
    // Sanity: the two interpretations are distinct — no contamination.
    expect(backF0.x).not.toBeCloseTo(backF1.x, 6)
    expect(backF0.y).not.toBeCloseTo(backF1.y, 6)
  })
})
