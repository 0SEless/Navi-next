# NAVI Studio — Progress Tracker

**Last updated:** 2026-06-22
**Status:** Phase 1 (Campus) in progress

---

## Purpose

Navi Studio is the admin indoor map editor for the NAVI campus navigation system at ASU Ibajay. Admins trace hallways/paths over a map; the system auto-generates the navigation graph (nodes at intersections/endpoints, edges between them). Rooms are drawn as polygons and auto-connected to hallways. The result is a unified indoor+outdoor graph that powers public wayfinding.

---

## Phases

### Phase 1: Campus Foundation
Campus-level overview, building outlines, OSM base map.

| What | Files | Status |
|------|-------|--------|
| Studio types (`StudioTool`, `EditorMode`, `LayerType`, etc.) | `src/types/studio-types.ts` | ✅ Done |
| Extended nav types (`TracePath`, `FloorPlan`, new edge types, polygon on `Component`) | `src/types/nav-types.ts` | ✅ Done |
| Type tests | `src/types/__tests__/types.test.ts` | ✅ Done |
| Studio Zustand store (tool, mode, layers, trace state) | `src/store/studio-store.ts` | ✅ Done |
| Studio store tests | `src/store/__tests__/studio-store.test.ts` | ✅ Done |
| Graph store with trace & polygon ops | `src/store/graph-store.ts` | ✅ Done |
| Workspace 3-panel layout | `src/components/studio/StudioWorkspace.tsx` | ✅ Done |
| MapLibre canvas with OSM, interaction handlers | `src/components/studio/StudioCanvas.tsx` | ✅ Done |
| Toolbar (8 tools, 3 editor modes, floor selector) | `src/components/studio/StudioToolbar.tsx` | ✅ Done |
| Layers panel (10 toggleable layers) | `src/components/studio/LayersPanel.tsx` | ✅ Done |
| Properties panel (building info, stats footer) | `src/components/studio/PropertiesPanel.tsx` | ✅ Done |
| Studio admin route `/studio` | `src/app/(admin)/studio/page.tsx` | ✅ Done |
| Admin layout with studio nav link | `src/app/(admin)/layout.tsx` | ✅ Done |
| **Building CRUD in campus mode** — add/edit/delete buildings via toolbar | — | ❌ Not built |
| **Building polygon rendering** — buildings as clickable shapes on canvas | — | ❌ Not wired |
| **Campus editor mode** — full campus-level interaction (not just mode toggle) | — | ❌ Not wired |

### Phase 2: Building Details
Per-building metadata editing, floor management.

| What | Files | Status |
|------|-------|--------|
| **BuildingMode.tsx** — in-place building editing (name, code, dept, floors) | `src/components/studio/BuildingMode.tsx` | ❌ Not built |
| **Building metadata editing** — editable fields in properties panel | — | ❌ Not built |
| **Floor add/remove** — manage floors per building | — | ❌ Not built |
| **Floor plan upload UI** — upload button per floor in properties panel | — | ❌ Not built |

### Phase 3: Floor Tracing
Floor-level view, trace-first workflow.

| What | Files | Status |
|------|-------|--------|
| Intersection engine (line crossing, endpoints, proximity) | `src/engine/intersection-engine.ts` | ✅ Done |
| Intersection engine tests | `src/engine/__tests__/intersection-engine.test.ts` | ✅ Done |
| Trace compiler (polyline → nodes + edges) | `src/engine/trace-compiler.ts` | ✅ Done |
| Trace compiler tests | `src/engine/__tests__/trace-compiler.test.ts` | ✅ Done |
| Graph class with trace CRUD + `addTraceWithCompile` | `src/engine/graph.ts` | ✅ Done |
| Trace interaction in canvas (click-to-add, dblclick-finalize) | `src/components/studio/StudioCanvas.tsx` (inline) | ✅ Done |
| **TraceTool.tsx** — dedicated trace interaction component | `src/components/studio/TraceTool.tsx` | ❌ Not built (logic inlined) |
| **FloorMode.tsx** — floor-specific view with overlay | `src/components/studio/FloorMode.tsx` | ❌ Not built |
| **Floor plan overlay on canvas** — uploaded image as reference layer | — | ❌ Not built |

### Phase 4: Rooms & Assets
Room polygons, asset placement.

| What | Files | Status |
|------|-------|--------|
| Component compiler with polygon output | `src/engine/component-compiler.ts` | ✅ Done |
| Component compiler tests | `src/engine/__tests__/component-compiler.test.ts` | ✅ Done |
| Room drag-to-create interaction (rectangle) | `src/components/studio/StudioCanvas.tsx` (inline) | ✅ Done |
| Asset placement via click | `src/components/studio/StudioCanvas.tsx` (inline) | ✅ Done |
| **RoomTool.tsx** — dedicated room component (L-shape, freeform presets) | `src/components/studio/RoomTool.tsx` | ❌ Not built |
| **L-shape / freeform room presets** | — | ❌ Not built |
| **Asset sub-type selector** (stairs vs elevator vs ramp etc.) | — | ❌ Not built |

### Phase 5: Markers & Testing
QR markers, panorama markers, route testing.

| What | Files | Status |
|------|-------|--------|
| **QR tool** — place QR markers on map | — | ❌ Not built |
| **Pano (360) tool** — place panorama markers | — | ❌ Not built |
| **Route Test tool** — visualize A* paths on canvas | — | ❌ Not built |

### Phase 6: Public Map
End-user navigation page.

| What | Files | Status |
|------|-------|--------|
| Public map page | `src/app/(public)/map/page.tsx` | ✅ Done |
| PublicMap component (OSM, buildings, routing, geolocation, QR scan) | `src/components/map/PublicMap.tsx` | ✅ Done |
| RouteLine component | `src/components/map/RouteLine.tsx` | ✅ Done |
| QRScanner component | `src/components/map/QRScanner.tsx` | ✅ Done |
| Floor plan upload API | `src/app/api/floor-plans/route.ts` | ✅ Done |
| **Building info panel** on public map | — | ❌ Not built |
| **Search / directory** on public map | — | ❌ Not built |

---

## Cross-Cutting

| What | Status |
|------|--------|
| Graph serialization (toJSON/fromJSON) with traces | ✅ Done |
| localStorage persistence | ✅ Done |
| Supabase sync (graph-store integration) | ✅ Done |
| Graph snapshot API | ✅ Done (`src/app/api/graph/route.ts`) |
| A* pathfinding | ✅ Done (`src/engine/a-star.ts`) |
| Graph validator | ✅ Done (`src/engine/graph-validator.ts`) |
| Directory builder | ✅ Done (`src/engine/directory.ts`) |
| Spatial resolver (geolocation → nearest node) | ✅ Done (`src/engine/spatial-resolver.ts`) |
| useGeolocation hook | ✅ Done (`src/hooks/useGeolocation.ts`) |
| Admin middleware (studio route protection) | ✅ Done (`src/middleware.ts`) |
| Deprecated map-editor cleanup | ❌ Not done |

---

## Summary

| Layer | Completion |
|-------|-----------|
| **Types** | 100% |
| **Engine** | 100% |
| **Stores** | 100% |
| **API** | 100% (graph + floor-plans) |
| **Public Map** | 90% (missing: building info panel, search) |
| **Studio UI** | 60% (layout done, dedicated tool components missing) |
| **Overall** | ~75% |

**Next priority:** Wire up Building CRUD in campus mode so the studio can create/manage buildings visually.
