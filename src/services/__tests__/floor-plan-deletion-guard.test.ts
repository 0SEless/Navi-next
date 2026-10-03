/**
 * Floor-plan shared-asset deletion guard — regression tests 1–5.
 * Spec: spec/FLOOR-PLAN-SHARED-ASSET-DELETION-GUARD-2026-09-27.md
 *
 * Invariant under test: a floor-plan asset may only be physically deleted
 * when NO authoritative floor-plan reference (per-floor planImageId, legacy
 * floorPlanUrls[level] fallback, or persisted floorPlanVisuals) resolves to
 * it. Reference existence takes precedence over storage-path ownership.
 *
 * Tests 1–4 drive the production pair exactly the way FloorEditor does after
 * a successful entity.update: collectBuildingFloorPlanReferences(building,
 * updatedFloor) → deleteFloorPlanImage(url, scope, { referencedUrls }).
 * Test 5 additionally dispatches the REAL `entity.update` command through
 * createEditorContext (production command + handler), not fixture mutation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase-client', () => ({ createClient }))

import { collectBuildingFloorPlanReferences, resolveFloorPlanUrl } from '../floor-plan-lifecycle'
import { deleteFloorPlanImage } from '../floor-plan-storage'
import { createEditorContext, NavigationCompiler } from '@navi/editor'
import type { PersistenceAdapter } from '@navi/editor'
import type { CampusDocument } from '@navi/core'

const SUPABASE_URL = 'https://storage.example'
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/floor-plans/map/building`

const urlA = `${STORAGE_PREFIX}/floor-0-A.png`
const urlB = `${STORAGE_PREFIX}/floor-0-B.png`
const urlC = `${STORAGE_PREFIX}/floor-1-C.png`
const urlD = `${STORAGE_PREFIX}/floor-0-D.png`

function ownedScope(floorLevel: number) {
  return { supabaseUrl: SUPABASE_URL, mapId: 'map', buildingId: 'building', floorLevel }
}

/** Mirrors FloorEditor's post-update wiring (replace path): stale captured
 *  building + post-update override for the floor that performed the change. */
async function runReplaceDeletion(
  building: Parameters<typeof collectBuildingFloorPlanReferences>[0],
  oldUrl: string,
  newPlanImageId: string,
  floorLevel: number,
) {
  const referencedUrls = collectBuildingFloorPlanReferences(building, {
    level: floorLevel,
    planImageId: newPlanImageId,
  })
  await deleteFloorPlanImage(oldUrl, ownedScope(floorLevel), { referencedUrls })
  return referencedUrls
}

describe('floor-plan shared-asset deletion guard', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  let remove: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createClient.mockReset()
    remove = vi.fn().mockResolvedValue({ error: null })
    createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } })
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
  })

  afterEach(() => {
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
  })

  // ── Test 1 — shared asset survives replacement ──
  it('Test 1 — shared asset survives replacement: GF=A,1F=A,2F=A; replace GF → A preserved, GF=B,1F=A,2F=A', async () => {
    const building = {
      floors: [0, 1, 2],
      floorData: [{ level: 0 }, { level: 1 }, { level: 2 }], // no planImageId → legacy fallback
      floorPlanUrls: { 0: urlA, 1: urlA, 2: urlA },
    }

    await runReplaceDeletion(building, urlA, urlB, 0)

    expect(remove).not.toHaveBeenCalled() // asset A PRESERVED
    // Bindings after the replacement (GF override applied, siblings untouched):
    expect(resolveFloorPlanUrl(building.floorPlanUrls[0], { planImageId: urlB })).toBe(urlB)
    expect(resolveFloorPlanUrl(building.floorPlanUrls[1], { planImageId: undefined })).toBe(urlA)
    expect(resolveFloorPlanUrl(building.floorPlanUrls[2], { planImageId: undefined })).toBe(urlA)
  })

  // ── Test 2 — asset is deleted when no references remain ──
  it('Test 2 — unreferenced asset is deleted: GF=A,1F=B,2F=C; replace GF → A removed from storage', async () => {
    const building = {
      floors: [0, 1, 2],
      floorData: [
        { level: 0, planImageId: urlA },
        { level: 1, planImageId: urlB },
        { level: 2, planImageId: urlC },
      ],
    }

    await runReplaceDeletion(building, urlA, urlD, 0)

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(['map/building/floor-0-A.png'])
    // Sibling bindings untouched by the deletion:
    expect(building.floorData[1].planImageId).toBe(urlB)
    expect(building.floorData[2].planImageId).toBe(urlC)
  })

  // ── Test 3 — one remaining sibling reference prevents deletion ──
  it('Test 3 — one sibling reference blocks deletion: GF=A,1F=A,2F=C; replace GF → A preserved and 1F still resolves A', async () => {
    const building = {
      floors: [0, 1, 2],
      floorData: [
        { level: 0, planImageId: urlA },
        { level: 1, planImageId: urlA },
        { level: 2, planImageId: urlC },
      ],
    }

    await runReplaceDeletion(building, urlA, urlD, 0)

    expect(remove).not.toHaveBeenCalled() // 1F still references A
    expect(resolveFloorPlanUrl(undefined, { planImageId: urlA })).toBe(urlA)
  })

  // ── Test 4 — legacy fallback prevents deletion ──
  it('Test 4 — legacy floorPlanUrls fallback blocks deletion even with no per-floor planImageId', async () => {
    // 4a: floorData entry exists but carries no planImageId key/value
    const withEntry = {
      floors: [0],
      floorData: [{ level: 0 }],
      floorPlanUrls: { 0: urlA },
    }
    await deleteFloorPlanImage(
      urlA,
      ownedScope(0),
      { referencedUrls: collectBuildingFloorPlanReferences(withEntry) },
    )
    expect(remove).not.toHaveBeenCalled()

    // 4b: no floorData entry at all for the level (legacy-only floor)
    const legacyOnly = { floors: [0], floorData: [], floorPlanUrls: { 0: urlA } }
    await deleteFloorPlanImage(
      urlA,
      ownedScope(0),
      { referencedUrls: collectBuildingFloorPlanReferences(legacyOnly) },
    )
    expect(remove).not.toHaveBeenCalled()
  })

  // ── Test 4b-extra — persisted floorPlanVisuals (public reader) block deletion ──
  it('persisted floorPlanVisuals imageUrl counts as an authoritative reference', async () => {
    const building = {
      floors: [0, 1],
      floorData: [{ level: 0, planImageId: urlB }, { level: 1, planImageId: urlC }],
      floorPlanVisuals: { 0: { imageUrl: urlA } }, // stale published visual still served by PublicMap
    }
    await runReplaceDeletion(building, urlA, urlB, 0)
    expect(remove).not.toHaveBeenCalled()
  })

  // ── Test 5 — actual update path (real entity.update dispatcher) ──
  describe('Test 5 — real entity.update path', () => {
    function createSharedDocument(): CampusDocument {
      return {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'map', name: 'Map', description: '', lastModified: '', editorVersion: '1' },
        buildings: [{
          id: 'building', name: 'Building', code: 'B', category: 'academic', description: '',
          footprint: { points: [
            { lat: 14, lng: 121 }, { lat: 14, lng: 121.001 },
            { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121 },
          ] },
          baseElevation: 0, height: 10, color: '#fff', aliases: [], metadata: {},
          floors: [
            { id: 'floor-gf', level: 0, label: 'GF', elevation: 0, height: 3.5, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], metadata: {}, planImageId: urlA },
            { id: 'floor-1f', level: 1, label: '1F', elevation: 3.5, height: 3.5, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], metadata: {}, planImageId: urlA },
            { id: 'floor-2f', level: 2, label: '2F', elevation: 7, height: 3.5, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], metadata: {}, planImageId: urlA },
          ],
        }],
        roads: [], panoramas: [], qrCheckpoints: [],
      } as CampusDocument
    }

    function createContext(document: CampusDocument) {
      const persistenceAdapter: PersistenceAdapter = {
        save: async () => {},
        syncToSupabase: async () => {},
        publish: async () => ({ success: true, version: '1.0.0' }),
      }
      const navCompiler = new NavigationCompiler({
        getGraph: () => ({ nodes: [], edges: [] }),
        updateNode: vi.fn(),
        updateEdge: vi.fn(),
      } as never)
      const graph = {
        campusId: 'map',
        name: 'Test Campus',
        buildings: [{
          id: 'building',
          name: 'Building',
          footprint: document.buildings[0].footprint,
          floors: [{ id: 'floor-gf', level: 0 }, { id: 'floor-1f', level: 1 }, { id: 'floor-2f', level: 2 }],
        }],
        traces: [], nodes: [], areas: [],
      }
      return createEditorContext(graph, persistenceAdapter, navCompiler, document)
    }

    it('dispatches entity.update, changes the GF binding, and preserves the still-referenced shared asset', async () => {
      const document = createSharedDocument()
      const ctx = createContext(document)
      const dispatcher = ctx.services.get('dispatcher') as { execute: (cmd: unknown) => { success?: boolean } | undefined }

      // Production FloorEditor captures the runtime building view BEFORE the
      // dispatch (stale mid-callback) — reproduce exactly that.
      const staleBuildingView = {
        floors: [0, 1, 2],
        floorData: [
          { level: 0, planImageId: urlA },
          { level: 1, planImageId: urlA },
          { level: 2, planImageId: urlA },
        ],
      }

      // The real production command (same id/payload shape as FloorEditor.handleUpload)
      const result = dispatcher.execute({
        id: 'entity.update',
        label: 'Replace Floor Plan',
        payload: { entityId: 'floor-gf', changes: { planImageId: urlB, floorPlanState: 'active' } },
      })

      // (1) Floor binding actually changed through the real handler.
      //     createEditorContext structuredClones the authored document, so the
      //     live post-dispatch state is ctx.document (production reads back
      //     from its own store the same way).
      expect(result?.success).not.toBe(false)
      expect(ctx.document.buildings[0].floors[0].planImageId).toBe(urlB)
      expect(ctx.document.buildings[0].floors[1].planImageId).toBe(urlA)
      expect(ctx.document.buildings[0].floors[2].planImageId).toBe(urlA)

      // (2) Real guard wiring (same as FloorEditor replace path): stale view
      //     + post-update override for the edited floor → old asset shared by
      //     1F/2F must survive physical deletion.
      await runReplaceDeletion(
        staleBuildingView,
        urlA,
        ctx.document.buildings[0].floors[0].planImageId as string,
        0,
      )

      expect(remove).not.toHaveBeenCalled() // shared asset PRESERVED
      expect(resolveFloorPlanUrl(undefined, { planImageId: urlA })).toBe(urlA) // 1F resolves A
    })

    it('deletes the old asset when the real update leaves no remaining references', async () => {
      const document = createSharedDocument()
      // Exclusive ownership: only GF references A
      document.buildings[0].floors[1].planImageId = undefined
      document.buildings[0].floors[2].planImageId = undefined
      const ctx = createContext(document)
      const dispatcher = ctx.services.get('dispatcher') as { execute: (cmd: unknown) => { success?: boolean } | undefined }

      const staleBuildingView = {
        floors: [0, 1, 2],
        floorData: [
          { level: 0, planImageId: urlA },
          { level: 1 }, // no planImageId, no legacy → resolves nothing
          { level: 2 },
        ],
      }

      const result = dispatcher.execute({
        id: 'entity.update',
        label: 'Replace Floor Plan',
        payload: { entityId: 'floor-gf', changes: { planImageId: urlB, floorPlanState: 'active' } },
      })
      expect(result?.success).not.toBe(false)
      expect(ctx.document.buildings[0].floors[0].planImageId).toBe(urlB)

      await runReplaceDeletion(
        staleBuildingView,
        urlA,
        ctx.document.buildings[0].floors[0].planImageId as string,
        0,
      )

      expect(remove).toHaveBeenCalledTimes(1)
      expect(remove).toHaveBeenCalledWith(['map/building/floor-0-A.png'])
    })
  })
})
