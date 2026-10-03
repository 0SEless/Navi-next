import { describe, it, expect } from 'vitest'
import { createDirtyTracker } from './DirtyTracker'

describe('DirtyTracker', () => {
  it('starts clean', () => {
    const d = createDirtyTracker()
    expect(d.isDirty).toBe(false)
    const f = d.flags
    expect(f.geometryDirty).toBe(false)
    expect(f.metadataDirty).toBe(false)
    expect(f.assetDirty).toBe(false)
    expect(f.compilerDirty).toBe(false)
  })

  it('markGeometryDirty sets geometry and compiler dirty', () => {
    const d = createDirtyTracker()
    d.markGeometryDirty()
    expect(d.flags.geometryDirty).toBe(true)
    expect(d.flags.compilerDirty).toBe(true)
    expect(d.flags.metadataDirty).toBe(false)
    expect(d.flags.assetDirty).toBe(false)
  })

  it('markMetadataDirty sets metadata and compiler dirty', () => {
    const d = createDirtyTracker()
    d.markMetadataDirty()
    expect(d.flags.metadataDirty).toBe(true)
    expect(d.flags.compilerDirty).toBe(true)
    expect(d.flags.geometryDirty).toBe(false)
    expect(d.flags.assetDirty).toBe(false)
  })

  it('markAssetDirty sets asset dirty without compiler by default', () => {
    const d = createDirtyTracker()
    d.markAssetDirty()
    expect(d.flags.assetDirty).toBe(true)
    expect(d.flags.compilerDirty).toBe(false)
  })

  it('markAssetDirty can trigger compiler dirty', () => {
    const d = createDirtyTracker()
    d.markAssetDirty(true)
    expect(d.flags.assetDirty).toBe(true)
    expect(d.flags.compilerDirty).toBe(true)
  })

  it('isDirty returns true if any flag is set', () => {
    const d = createDirtyTracker()
    expect(d.isDirty).toBe(false)
    d.markMetadataDirty()
    expect(d.isDirty).toBe(true)
  })

  it('clearGeometryDirty clears only geometry', () => {
    const d = createDirtyTracker()
    d.markGeometryDirty()
    d.clearGeometryDirty()
    expect(d.flags.geometryDirty).toBe(false)
    expect(d.flags.compilerDirty).toBe(true) // compiler stays dirty
  })

  it('clearCompilerDirty clears only compiler', () => {
    const d = createDirtyTracker()
    d.markGeometryDirty()
    d.clearCompilerDirty()
    expect(d.flags.geometryDirty).toBe(true)
    expect(d.flags.compilerDirty).toBe(false)
  })

  it('clearAll resets all flags', () => {
    const d = createDirtyTracker()
    d.markGeometryDirty()
    d.markMetadataDirty()
    d.clearAll()
    expect(d.isDirty).toBe(false)
  })

  it('snapshot captures current state', () => {
    const d = createDirtyTracker()
    d.markGeometryDirty()
    const snap = d.snapshot()
    expect(snap.geometryDirty).toBe(true)
    expect(snap.compilerDirty).toBe(true)
  })

  it('snapshot is immutable to subsequent changes', () => {
    const d = createDirtyTracker()
    const snap = d.snapshot()
    d.markGeometryDirty()
    expect(snap.geometryDirty).toBe(false)
  })

  it('flags are read-only copies', () => {
    const d = createDirtyTracker()
    d.markGeometryDirty()
    const f = d.flags
    expect(f.geometryDirty).toBe(true)
    // Modifying the returned object does not affect the tracker
    ;(f as any).geometryDirty = false
    expect(d.flags.geometryDirty).toBe(true)
  })
})
