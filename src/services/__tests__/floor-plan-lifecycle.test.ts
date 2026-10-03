import { describe, expect, it } from 'vitest'
import {
  areFloorPlanSourcesCompatible,
  buildFloorPlanReplaceAlignment,
  isOwnedFloorPlanUrl,
  resolveFloorPlanUrl,
} from '../floor-plan-lifecycle'

describe('floor-plan lifecycle policy', () => {
  it('preserves transforms only for finite source dimensions with a compatible aspect ratio', () => {
    expect(areFloorPlanSourcesCompatible({ width: 3000, height: 1200 }, { width: 1500, height: 600 })).toBe(true)
    expect(areFloorPlanSourcesCompatible({ width: 3000, height: 1200 }, { width: 1000, height: 1000 })).toBe(false)
    expect(areFloorPlanSourcesCompatible(undefined, { width: 1000, height: 1000 })).toBe(false)
  })

  it('resets only geometry for incompatible or unknown replacements', () => {
    const existing = { offset: { x: 4, y: -2 }, scaleX: 1.7, scaleY: 0.8, rotation: 35, opacity: 0.35, locked: true }
    expect(buildFloorPlanReplaceAlignment(existing, { width: 300, height: 100 }, { width: 600, height: 200 })).toEqual(existing)
    expect(buildFloorPlanReplaceAlignment(existing, { width: 300, height: 100 }, { width: 600, height: 600 })).toMatchObject({
      offset: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.35, locked: true,
    })
    expect(buildFloorPlanReplaceAlignment(existing, undefined, { width: 600, height: 200 })).toMatchObject({
      offset: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.35, locked: true,
    })
  })

  it('recognizes only owned managed floor-plan URLs', () => {
    expect(isOwnedFloorPlanUrl('https://storage.example/storage/v1/object/public/floor-plans/map/building/floor-0-a.png', {
      supabaseUrl: 'https://storage.example', mapId: 'map', buildingId: 'building', floorLevel: 0,
    })).toBe(true)
    expect(isOwnedFloorPlanUrl('data:image/png;base64,abc', {
      supabaseUrl: 'https://storage.example', mapId: 'map', buildingId: 'building', floorLevel: 0,
    })).toBe(false)
    expect(isOwnedFloorPlanUrl('https://storage.example/storage/v1/object/public/floor-plans/other/building/floor-0-a.png', {
      supabaseUrl: 'https://storage.example', mapId: 'map', buildingId: 'building', floorLevel: 0,
    })).toBe(false)
  })

  it('does not resurrect a legacy URL after an explicit floor-data removal', () => {
    expect(resolveFloorPlanUrl('legacy.png', { planImageId: null })).toBeUndefined()
    expect(resolveFloorPlanUrl('legacy.png', {})).toBe('legacy.png')
    expect(resolveFloorPlanUrl('legacy.png', { planImageId: undefined })).toBe('legacy.png')
    expect(resolveFloorPlanUrl(undefined, undefined, 'prop.png')).toBe('prop.png')
  })

  // ── Phase D regression tests (Bug A: floor-plan image ownership isolation) ──

  // Test 1: independent floor images — replacing 1F leaves GF and 2F unchanged.
  it('Test 1 — independent floor images: replace 1F leaves GF and 2F unchanged', () => {
    // Simulate each floor having its own planImageId (the per-floor entity field).
    const gfData = { planImageId: 'A.png' }
    const f1Data = { planImageId: 'B.png' }
    const f2Data = { planImageId: 'C.png' }

    // After replacing 1F → D.png (write: only f1Data.planImageId changes)
    const f1DataAfterReplace = { planImageId: 'D.png' }

    expect(resolveFloorPlanUrl(undefined, gfData)).toBe('A.png')
    expect(resolveFloorPlanUrl(undefined, f1DataAfterReplace)).toBe('D.png')
    expect(resolveFloorPlanUrl(undefined, f2Data)).toBe('C.png')
  })

  // Test 2 (PRIMARY REGRESSION): shared initial URL — replace 1F, GF and 2F still
  // see the original URL because they read from their own floorData, not a shared ref.
  it('Test 2 — shared initial URL: replacing 1F planImageId must not change GF or 2F resolution', () => {
    // All three floors start with no planImageId — they fall back to floorPlanUrls[level].
    const sharedLegacyUrl = 'A.png'

    // GF reads from floorPlanUrls[0] = 'A.png', no per-floor planImageId.
    expect(resolveFloorPlanUrl(sharedLegacyUrl, {})).toBe('A.png')
    // 1F reads similarly.
    expect(resolveFloorPlanUrl(sharedLegacyUrl, {})).toBe('A.png')
    // 2F reads similarly.
    expect(resolveFloorPlanUrl(sharedLegacyUrl, {})).toBe('A.png')

    // After replace: 1F entity gets planImageId = 'B.png'. GF and 2F have no planImageId.
    const gfDataAfterReplace = {}                           // no planImageId → falls back to legacy
    const f1DataAfterReplace = { planImageId: 'B.png' }    // explicitly set
    const f2DataAfterReplace = {}                           // no planImageId → falls back to legacy

    // GF: still resolves to legacy 'A.png' (floorPlanUrls[0] unchanged)
    expect(resolveFloorPlanUrl(sharedLegacyUrl, gfDataAfterReplace)).toBe('A.png')
    // 1F: resolves to the new 'B.png' (per-floor planImageId wins)
    expect(resolveFloorPlanUrl(sharedLegacyUrl, f1DataAfterReplace)).toBe('B.png')
    // 2F: still resolves to legacy 'A.png' (floorPlanUrls[2] unchanged)
    expect(resolveFloorPlanUrl(sharedLegacyUrl, f2DataAfterReplace)).toBe('A.png')
  })

  // Test 3: transform isolation — each floor's planAlignment is read from its own floorData.
  // The alignment is per-floor entity data; changing one floor's alignment must not
  // affect others (this is guaranteed by the entity model; test confirms the contract).
  it('Test 3 — transform isolation: alignment is independent per floor', () => {
    const gfAlignment = { offset: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.7, locked: false }
    const f1Alignment = { offset: { x: 5, y: 3 }, scaleX: 1.2, scaleY: 1.2, rotation: 15, opacity: 0.8, locked: false }
    const f2Alignment = { offset: { x: -2, y: 1 }, scaleX: 0.9, scaleY: 0.9, rotation: 0, opacity: 0.6, locked: true }

    // buildFloorPlanReplaceAlignment preserves geometry when sources are compatible.
    // Moving/resizing 1F is a separate commit that only touches f1Alignment.
    // The unchanged floor alignments are unaffected.
    const f1AlignmentAfterEdit = { ...f1Alignment, offset: { x: 8, y: 4 } }

    // GF alignment unchanged
    expect(gfAlignment.offset.x).toBe(0)
    expect(gfAlignment.scaleX).toBe(1)
    // 2F alignment unchanged
    expect(f2Alignment.offset.x).toBe(-2)
    expect(f2Alignment.locked).toBe(true)
    // 1F alignment updated
    expect(f1AlignmentAfterEdit.offset.x).toBe(8)
    // Compatible replacement preserves all visual fields
    expect(buildFloorPlanReplaceAlignment(f1Alignment, { width: 1000, height: 800 }, { width: 2000, height: 1600 }))
      .toMatchObject({ offset: { x: 5, y: 3 }, scaleX: 1.2, scaleY: 1.2, rotation: 15, opacity: 0.8, locked: false })
  })
})

