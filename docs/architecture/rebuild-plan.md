# Rebuild Plan: pps/studio-new/

> Generated 2026-07-15 — file-by-file plan for a clean studio application that imports from @navi/packages/*.

---

## Architecture Overview

`
apps/studio-new/
├── app/                          # Next.js App Router pages
│   ├── layout.tsx                # Root layout (AuthProvider + CSS)
│   ├── page.tsx                  # Login/redirect page
│   ├── (admin)/                  # Authenticated routes
│   │   ├── layout.tsx            # AppLayout (sidebar + header)
│   │   ├── dashboard/page.tsx    # StudioDashboard (map list)
│   │   └── studio/
│   │       ├── layout.tsx        # StoreInitializer
│   │       ├── page.tsx          # Map creation / selection
│   │       └── [id]/page.tsx     # StudioWorkspace (the editor)
│   └── api/                      # API routes
│       └── compile/route.ts      # Server-side compilation
├── components/
│   ├── studio/
│   │   ├── StudioCanvas.tsx      # Map composition root
│   │   ├── StudioWorkspace.tsx   # Toolbar + canvas + panels layout
│   │   ├── StudioToolbar.tsx     # Mode/tool/undo/save/publish bar
│   │   ├── EditorBridge.tsx      # Context creation + selection sync
│   │   ├── StoreInitializer.tsx  # Load persisted data
│   │   ├── MapRenderer.tsx       # GeoJSON source/layer + data sync
│   │   ├── InteractionController.tsx  # Map event → tool wiring
│   │   ├── ViewportController.tsx     # Camera flyTo/fitBounds
│   │   ├── SelectionOverlay.tsx  # MapLibre feature state sync
│   │   ├── DrawingOverlay.tsx    # Ephemeral drawing geometry
│   │   ├── ExplorerPanel.tsx     # Building/floor/entity tree
│   │   ├── LayersOverlay.tsx     # Layer visibility toggles
│   │   └── ConfirmOverlay.tsx    # Confirm/cancel for drawings
│   ├── providers/
│   │   └── AuthProvider.tsx      # Auth context
│   └── layout/
│       └── AppLayout.tsx         # Sidebar + header shell
├── lib/
│   ├── persistence.ts            # PersistenceAdapter (localStorage)
│   ├── supabase-client.ts        # Supabase browser client
│   ├── compiler-adapter.ts       # API-based CompilerAdapter
│   ├── auth.ts                   # useAuth hook + context
│   └── utils.ts                  # Shared utilities
├── styles/
│   └── globals.css               # CSS variables + base styles
├── package.json
├── tsconfig.json
├── next.config.js
└── tailwind.config.js
`

---

## Phase 1: Scaffold

### Step 1.1 — Create the app directory

`
apps/studio-new/
`

**Action:** Create pps/studio-new/ directory with standard Next.js setup.

**Files to create (new):**

| File | Source | Notes |
|---|---|---|
| pps/studio-new/package.json | New | Deps: @navi/core, @navi/editor, @navi/compiler, @navi/runtime, 
ext, eact, maplibre-gl, lucide-react, zustand, @supabase/ssr |
| pps/studio-new/tsconfig.json | New | Extend workspace root tsconfig, include ./src |
| pps/studio-new/next.config.js | New | Standard Next.js config |
| pps/studio-new/tailwind.config.js | New | (if using Tailwind) |
| pps/studio-new/postcss.config.js | New | (if using Tailwind) |

---

## Phase 2: Create Files (app-only code)

These are the files the new app **must write** because no package provides them:

### Step 2.1 — Root layout + styles

**COPY from current app:**

| Source | Destination | Reason |
|---|---|---|
| src/app/globals.css | pps/studio-new/styles/globals.css | CSS variables, fonts, base styles |
| src/app/layout.tsx | pps/studio-new/app/layout.tsx | Root layout with AuthProvider wrapper |

### Step 2.2 — Auth system

**COPY from current app:**

| Source | Destination | Reason |
|---|---|---|
| src/components/providers/AuthProvider.tsx | pps/studio-new/components/providers/AuthProvider.tsx | Full auth implementation |
| src/hooks/useAuth.ts | pps/studio-new/lib/auth.ts | Auth context + hook |
| src/lib/mock-auth.ts | pps/studio-new/lib/mock-auth.ts | Mock auth for development |
| src/types/user.ts | pps/studio-new/types/user.ts | User type |

**DEVIATION:** Simplify — strip campus_map_id fields, use only what studio needs.

### Step 2.3 — Supabase client

**COPY from current app:**

| Source | Destination | Reason |
|---|---|---|
| src/lib/supabase-client.ts | pps/studio-new/lib/supabase-client.ts | Browser client creation |
| src/lib/supabase-server.ts | pps/studio-new/lib/supabase-server.ts | Server client creation |

### Step 2.4 — Persistence adapter

**NEW file:** pps/studio-new/lib/persistence.ts

Implements PersistenceAdapter from @navi/editor:
`	ypescript
import type { PersistenceAdapter } from '@navi/editor'
export function createPersistenceAdapter(): PersistenceAdapter { ... }
`

**What it does:**
- save() — serialize CampusDocument to localStorage
- syncToSupabase() — POST to /api/graph
- publish(artifacts) — POST to /api/publish

**COPY logic from:**
| Source | What to take |
|---|---|
| src/store/graph-store.ts | save(), load(), syncToSupabase(), etchFromSupabase() logic |
| src/services/compiler-adapter.ts | The createCompilerAdapter() pattern |
| packages/editor/src/services/persistence-service.ts | The PersistenceAdapter interface contract |

### Step 2.5 — Compiler adapter

**NEW file:** pps/studio-new/lib/compiler-adapter.ts

Implements CompilerAdapter from @navi/editor:

**COPY from current app:**
| Source | Destination |
|---|---|
| src/services/compiler-adapter.ts | pps/studio-new/lib/compiler-adapter.ts |

(Almost identical — just update import paths.)

### Step 2.6 — API route: compile

**COPY from current app:**

| Source | Destination |
|---|---|
| src/app/api/compile/route.ts | pps/studio-new/app/api/compile/route.ts |

Or better: create a simpler version that uses CampusCompiler directly.

### Step 2.7 — AppLayout (admin shell)

**COPY from current app:**

| Source | Destination |
|---|---|
| src/components/layout/AppLayout.tsx | pps/studio-new/components/layout/AppLayout.tsx |
| src/app/(admin)/layout.tsx | pps/studio-new/app/(admin)/layout.tsx |
| src/types/screens.ts | pps/studio-new/types/screens.ts |

### Step 2.8 — Studio layout + store initializer

**COPY from current app:**

| Source | Destination |
|---|---|
| src/app/(admin)/studio/layout.tsx | pps/studio-new/app/(admin)/studio/layout.tsx |
| src/components/studio/StoreInitializer.tsx | pps/studio-new/components/studio/StoreInitializer.tsx |

Simplify: StoreInitializer should create a blank CampusDocument or load from localStorage instead of the legacy Graph.

### Step 2.9 — StudioDashboard

**NEW** (lightweight rewrite, no legacy graph dependency):

pps/studio-new/app/(admin)/dashboard/page.tsx

Shows list of saved campus documents from localStorage, "Create New" button.
Use CampusDocument directly instead of legacy CampusMap.

### Step 2.10 — StudioWorkspace

**COPY from current app:** src/components/studio/StudioWorkspace.tsx

| Source | Destination |
|---|---|
| src/components/studio/StudioWorkspace.tsx | pps/studio-new/components/studio/StudioWorkspace.tsx |

**Modifications:**
- Remove mapId prop dependency (the new workspace creates CampusDocument directly)
- EditorBridge is simplified (see Step 2.11)

### Step 2.11 — EditorBridge (simplified)

**COPY then REWRITE** from src/components/studio/EditorBridge.tsx

The new version:
`	sx
export function EditorBridge({ children }: { children: ReactNode }) {
  const persistence = createPersistenceAdapter()
  const navCompiler = new NavigationCompiler(createCompilerAdapter())
  const [context] = useState(() => {
    const doc = loadDocument() // from localStorage
    return createEditorContext(doc, persistence, navCompiler)
  })
  // ... wire SelectionBridge to local store ...
  return <EditorProvider context={context}>{children}</EditorProvider>
}
`

**Key changes from current version:**
- No dependency on useGraphStore (legacy Graph)
- No dependency on useStudioStore (legacy tool/layer state)
- Creates CampusDocument directly from localStorage
- Uses a lightweight Zustand store for local-only UI state (tool, layers, etc.)

### Step 2.12 — New local UI store (replaces legacy useStudioStore)

**NEW file:** pps/studio-new/store/ui-store.ts

`	ypescript
// Minimal UI state for the new studio
interface UIState {
  tool: string
  mode: 'campus' | 'building' | 'floor'
  activeBuildingId: string | null
  activeFloorId: string | null
  layers: Record<string, boolean>
}
`

**COPY pattern from:** src/store/studio-store.ts but simplified — remove trace points, pending confirmation, vertex editing, and other legacy state that the editor package now manages.

### Step 2.13 — StudioCanvas

**COPY from current app:** src/components/studio/StudioCanvas.tsx

| Source | Destination |
|---|---|
| src/components/studio/StudioCanvas.tsx | pps/studio-new/components/studio/StudioCanvas.tsx |

**Modifications:**
- Replace useGraphStore references with useEditor from @navi/editor
- Map creation logic stays (MapLibre init is app-layer)
- MapRenderer + ViewportController + InteractionController stay

### Step 2.14 — MapRenderer

**COPY from current app:** src/components/studio/rendering/

| Source | Destination |
|---|---|
| src/components/studio/rendering/MapRenderer.tsx | pps/studio-new/components/studio/MapRenderer.tsx |
| src/components/studio/rendering/layers.ts | pps/studio-new/components/studio/layers.ts |
| src/components/studio/rendering/constants.ts | pps/studio-new/components/studio/constants.ts |
| src/components/studio/rendering/geojson.ts | pps/studio-new/components/studio/geojson.ts |

**Modifications to MapRenderer:**
- Remove useGraphStore dependency — read graph/document from useEditor + useDocumentVersion
- Remove references to legacy Graph class — use CampusDocument buildings/roads directly
- uildingsToGeoJSON and oadsToTracesGeoJSON already come from @navi/editor
- Node/edge rendering uses @navi/compiler NavigationGraph types

**Modifications to geojson.ts:**
- Replace legacy NavNode/NavEdge types with @navi/compiler types
- Or remove entirely — let the compiler output drive mapping

### Step 2.15 — InteractionController

**COPY from current app:** src/components/studio/InteractionController.tsx

| Source | Destination |
|---|---|
| src/components/studio/InteractionController.tsx | pps/studio-new/components/studio/InteractionController.tsx |

**Modifications:**
- Replace useGraphStore references with useEditor + CommandDispatcher
- Replace useStudioStore references with new UI store
- Drawing tools use ToolRegistry from @navi/editor instead of legacy tool enum
- Click handling: map.queryRenderedFeatures still works but reads from @navi/editor layers

### Step 2.16 — ViewportController

**COPY** without changes:

| Source | Destination |
|---|---|
| src/components/studio/ViewportController.tsx | pps/studio-new/components/studio/ViewportController.tsx |

(Already uses useEditor and ViewportCommand from @navi/editor.)

### Step 2.17 — SelectionOverlay

**COPY** without changes:

| Source | Destination |
|---|---|
| src/components/studio/SelectionOverlay.tsx | pps/studio-new/components/studio/SelectionOverlay.tsx |

(Already uses useSelection from @navi/editor.)

### Step 2.18 — DrawingOverlay

**COPY** without changes:

| Source | Destination |
|---|---|
| src/components/studio/DrawingOverlay.tsx | pps/studio-new/components/studio/DrawingOverlay.tsx |
| src/components/studio/useDrawingSession.tsx | pps/studio-new/components/studio/useDrawingSession.tsx |

### Step 2.19 — StudioToolbar

**COPY** then simplify:

| Source | Destination |
|---|---|
| src/components/studio/StudioToolbar.tsx | pps/studio-new/components/studio/StudioToolbar.tsx |

**Modifications:**
- Remove publish state polling (use PublishService snapshot directly)
- Replace legacy EditorMode with @navi/editor's EditorMode type
- Floor tabs read from DocumentStore via useEditor
- Save button triggers WorkflowService.save()

### Step 2.20 — ExplorerPanel

**NEW** — build from @navi/editor hooks:

pps/studio-new/components/studio/ExplorerPanel.tsx

Uses:
- useEditor → document.buildings
- useActiveBuilding, useBuilding, useBuildingFloors
- useSelection for selection state
- useDocumentVersion for reactivity

**COPY patterns from:**
| Source | What to take |
|---|---|
| src/components/studio/ExplorerPanel.tsx | Tree structure, expand/collapse logic |
| src/components/studio/ExplorerItem.tsx | Item rendering |
| src/components/studio/ExplorerTree.tsx | Tree component |
| src/components/studio/ExplorerSearch.tsx | Search/filter |
| src/components/studio/ExplorerContextMenu.tsx | Right-click menus |
| src/components/studio/getExplorerActions.ts | Action definitions |

**Modifications:**
- Replace useGraphStore with useEditor + CommandDispatcher
- "Add building" triggers uildingCreateHandler via dispatcher
- "Add room" triggers oomCreateHandler
- Selection uses SelectionManager not legacy selectedNodeId

### Step 2.21 — ConfirmBar + ConfirmOverlay

**COPY** without significant changes:

| Source | Destination |
|---|---|
| src/components/studio/ConfirmBar.tsx | pps/studio-new/components/studio/ConfirmBar.tsx |
| src/components/studio/ConfirmOverlay.tsx | pps/studio-new/components/studio/ConfirmOverlay.tsx |
| src/components/studio/ConfirmOverlayAdapter.tsx | pps/studio-new/components/studio/ConfirmOverlayAdapter.tsx |

### Step 2.22 — Remaining overlays

**COPY** without significant changes:

| Source | Destination |
|---|---|
| src/components/studio/PreviewOverlay.tsx | pps/studio-new/components/studio/PreviewOverlay.tsx |
| src/components/studio/CampusBoundary.tsx | pps/studio-new/components/studio/CampusBoundary.tsx |
| src/components/studio/BuildingTracer.tsx | pps/studio-new/components/studio/BuildingTracer.tsx |
| src/components/studio/useVertexEditor.ts | pps/studio-new/components/studio/useVertexEditor.ts |
| src/components/studio/useToolController.ts | pps/studio-new/components/studio/useToolController.ts |
| src/components/studio/useEntrancePlacer.ts | pps/studio-new/components/studio/useEntrancePlacer.ts |

---

## Phase 3: Files to DELETE from current app

Once pps/studio-new/ works with the same data, the following files in src/ become dead code:

### Delete (replaced by packages):

| File | Replaced by |
|---|---|
| src/engine/graph.ts | @navi/core types + @navi/editor DocumentStore |
| src/engine/component-compiler.ts | @navi/compiler CampusCompiler |
| src/engine/a-star.ts | @navi/runtime AStar |
| src/engine/graph-validator.ts | @navi/editor ValidationEngine |
| src/engine/geometry.ts | @navi/core geometry |
| src/engine/geo-utils.ts | @navi/core geometry |
| src/engine/intersection-engine.ts | @navi/core topology |
| src/engine/spatial-resolver.ts | @navi/core spatial-index |
| src/engine/trace-compiler.ts | @navi/compiler |
| src/engine/directory.ts | @navi/compiler |
| src/types/nav-types.ts | @navi/core types |
| src/types/campus.ts | @navi/core CampusDocument |
| src/types/building.ts | @navi/core Building |
| src/types/studio-types.ts | @navi/editor EditorMode + Tool types |
| src/store/graph-store.ts | @navi/editor DocumentStore + PersistenceService |
| src/store/studio-store.ts | @navi/editor ToolRegistry + new UI store |

### Keep (still used by public/consumer pages):

| File | Reason |
|---|---|
| src/app/(public)/* | Public map viewer, route testing |
| src/components/map/CampusMap.tsx | Public map component |
| src/components/map/PublicMap.tsx | Public map page |
| src/components/map/RouteLine.tsx | Route rendering |
| src/components/map/PanoramaViewer.tsx | Panorama viewer |
| src/components/map/QRScanner.tsx | QR scanner |
| src/components/route/* | Route testing UI |
| src/components/search/* | Public search UI |
| src/store/public-store.ts | Public-side state |
| src/store/campus-map-store.ts | Legacy map metadata (may migrate later) |

### Keep (infrastructure reused by new app):

| File | Reason |
|---|---|
| src/app/api/compile/route.ts | Server-side compilation endpoint (new app uses same API) |
| src/app/api/publish/route.ts | Publish endpoint |
| src/app/api/graph/route.ts | Graph persistence endpoint |
| src/lib/supabase-client.ts | Supabase browser client |
| src/lib/supabase-server.ts | Supabase server client |
| src/lib/mock-auth.ts | Mock auth utility |
| src/lib/db-schema.ts | Database schema types |

---

## Phase 4: Dependencies between components

### Component dependency graph (new studio):

`
StudioDashboard
  └── uses: persistence.ts (load/save document list)

StudioWorkspace
  ├── EditorBridge
  │   ├── creates: EditorContext (via createEditorContext)
  │   ├── uses: persistence.ts (PersistenceAdapter)
  │   ├── uses: compiler-adapter.ts (CompilerAdapter)
  │   └── creates: EditorProvider context
  ├── StudioToolbar
  │   └── uses: useEditor (EditorContext)
  ├── ExplorerPanel
  │   └── uses: useEditor, useSelection, CommandDispatcher
  ├── StudioCanvas
  │   ├── MapRenderer
  │   │   └── uses: useEditor, useDocumentVersion, buildingsToGeoJSON
  │   ├── ViewportController
  │   │   └── uses: useEditor (Viewport service)
  │   ├── InteractionController
  │   │   └── uses: useEditor (ToolRegistry, CommandDispatcher), UI store
  │   ├── SelectionOverlay
  │   │   └── uses: useSelection
  │   ├── DrawingOverlay
  │   │   └── uses: useDrawingSession (local state)
  │   └── ConfirmBar + ConfirmOverlay
  │       └── uses: useDrawingSession
  ├── PropertiesPanel (imported from @navi/editor!)
  └── FloorManager (imported from @navi/editor!)
`

### Build order:

1. lib/persistence.ts (no deps beyond packages)
2. lib/compiler-adapter.ts (no deps beyond packages)
3. lib/auth.ts + AuthProvider.tsx (no deps beyond supabase)
4. store/ui-store.ts (zustand only)
5. EditorBridge.tsx (depends on #1, #2)
6. components/studio/ViewportController.tsx (depends on EditorContext)
7. components/studio/SelectionOverlay.tsx (depends on EditorContext)
8. components/studio/MapRenderer.tsx + layers.ts + constants.ts + geojson.ts (depends on EditorContext)
9. components/studio/InteractionController.tsx (depends on #5, #8)
10. components/studio/useDrawingSession.tsx (no packages deps)
11. components/studio/DrawingOverlay.tsx (depends on #10)
12. components/studio/ConfirmBar.tsx + ConfirmOverlay.tsx (depends on #10)
13. components/studio/StudioCanvas.tsx (depends on #6-12)
14. components/studio/StudioToolbar.tsx (depends on EditorContext)
15. components/studio/ExplorerPanel.tsx (depends on EditorContext)
16. components/studio/StudioWorkspace.tsx (depends on #5, #13, #14, #15)
17. pp/(admin)/studio/[id]/page.tsx (depends on #16)

---

## Phase 5: Package.json dependencies for the new app

`json
{
  "dependencies": {
    "@navi/core": "*",
    "@navi/compiler": "*",
    "@navi/editor": "*",
    "next": "^16",
    "react": "^19",
    "react-dom": "^19",
    "maplibre-gl": "^5",
    "lucide-react": "^1",
    "zustand": "^5",
    "@supabase/ssr": "^0.12",
    "@supabase/supabase-js": "^2"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5",
    "tailwindcss": "^3",
    "postcss": "^8",
    "autoprefixer": "^10"
  }
}
`

Note: @navi/runtime is NOT needed in the editor app — it is for the public-facing runtime (navigation engine, search). The editor uses @navi/compiler for compilation and @navi/editor for editing.

---

## Summary

| Category | Count | Key files |
|---|---|---|
| New files | ~5 | lib/persistence.ts, store/ui-store.ts, dashboard/page.tsx, ExplorerPanel.tsx |
| Copy from current app | ~30 | StudioCanvas, MapRenderer, InteractionController, ViewportController, overlays, toolbar, layout |
| Modify from current app | ~8 | EditorBridge (simplified), StoreInitializer, MapRenderer, InteractionController, StudioToolbar, geojson.ts |
| Import directly from packages | ~10 | PropertiesPanel, FloorManager, LayersPanel, ProblemsPanel, ValidationEngine, ToolRegistry, commands, hooks |
| Delete from current app | ~18 | engine/*, types/nav-types, store/graph-store, store/studio-store |
| Time estimate | 3-5 days | Sequential build following dependency graph |
