# NAVI Studio — Map System Design

## 1. Domain Model

### Core Entities

**Campus**
- Top-level container. All records scoped by `campus_id`.

**Building**
- Polygon outline on map (rectangle or polygon drawing).
- Metadata: name, code, department, description, floors count, accessibility info, contact (optional).
- Cover image (displayed in info panel only — never on map).

**Floor**
- Belongs to Building. Ordered: GF → 1F → 2F → 3F (descending).
- Floor plan image: uploaded reference only, used for tracing.
- Status indicator: ✓ uploaded / ✗ missing (no thumbnails).

**Room**
- Polygon geometry (editable vertices) — always the canonical form.
- Creation via presets (rectangle, L-shape, freeform) that immediately convert to polygon.
- Metadata: name, type, capacity, department.
- NOT an asset.

**Asset**
- Reusable structural objects: Door, Stairs, Elevator, Ramp, Restroom, Emergency Exit.
- Rooms are NOT assets.

**TracePath**
- Polyline with optional curvature — drawn by admin over OSM base or floor plan.
- Visual layer only. Routing uses generated nodes/edges.
- Types: hallway (indoor), path (outdoor).

**Marker**
- QR Marker: attached to a NavNode for positioning/recovery.
- Panorama Marker: attached to a NavNode with image URL for 360 exploration.

### Navigation Graph

**NavNode**
- Auto-generated from traces: endpoints, intersections, room/stair/entrance connections.
- Manual placement for: building entrances, gates, stair/elevator anchors, correction of auto-results.
- Types: `building_entrance`, `intersection`, `staircase`, `elevator`, `room`, `outdoor`, `waypoint`.

**NavEdge**
- Auto-generated from trace topology. Never manually authored in the default workflow.
- Types: `WALK` (hallways, corridors, outdoor paths), `TRANSITION` (outdoor→entrance, entrance→hallway, floor-to-floor), `RESTRICTED` (faculty/private zones).
- Weighted by Haversine distance.

**Graph**
- Single unified navigation graph. No indoor/outdoor separation.
- Indoor ↔ outdoor connected via transition nodes (entrance nodes belong to both contexts).

## 2. Module Structure

```
src/
├── engine/
│   ├── graph.ts                # Graph class, CRUD, queries, serialization
│   ├── a-star.ts               # A* pathfinding (Haversine heuristic)
│   ├── graph-validator.ts      # 10+ validation checks
│   ├── directory.ts            # Auto-build directory tree
│   ├── component-compiler.ts   # Preset → polygon + graph converter
│   ├── trace-compiler.ts       # [NEW] TracePath → nodes + edges
│   └── intersection-engine.ts  # [NEW] Line intersection detection
├── types/
│   ├── nav-types.ts            # Extended: TracePath, FloorPlan, edge types
│   └── studio-types.ts         # [NEW] Studio UI types
├── store/
│   ├── graph-store.ts          # Extended: trace ops, polygon room ops
│   └── studio-store.ts         # [NEW] Studio editor state
├── components/
│   ├── studio/
│   │   ├── StudioWorkspace.tsx # Main 3-panel layout
│   │   ├── StudioCanvas.tsx    # MapLibre GL editing canvas
│   │   ├── StudioToolbar.tsx   # Select | Move | Trace | Room | Asset | QR | 360 | Route
│   │   ├── LayersPanel.tsx     # Left panel (layers/assets tree)
│   │   ├── PropertiesPanel.tsx # Right panel (context-sensitive)
│   │   ├── BuildingMode.tsx    # In-place building editing
│   │   ├── FloorMode.tsx       # Floor-specific view
│   │   ├── RoomTool.tsx        # Room preset → polygon
│   │   └── TraceTool.tsx       # Hallway/path tracing interaction
│   └── map/                    # Public map view
├── app/
│   ├── (admin)/studio/         # NAVI Studio route
│   ├── (public)/map/           # Public navigation page
│   └── api/
│       ├── graph/route.ts      # GET/POST graph snapshot
│       └── floor-plans/route.ts# [NEW] Floor plan image upload
└── lib/supabase/               # Client helpers
```

## 3. Data Flow

### Trace → Graph Pipeline
```
Admin traces polyline on canvas
  → TracePath stored (editable geometry)
  → Intersection detection (endpoints, crossings, proximities)
  → NavNodes generated at each decision point
  → NavEdges (WALK) created between sequential nodes
  → Graph updated → A* routing available
```

### Room Creation Pipeline
```
Select preset (rectangle / L-shape / freeform)
  → Drag on canvas
  → Polygon geometry created immediately
  → Room added to floor's vector layer
  → Entrance node auto-created at nearest hallway
  → Edge (TRANSITION) connects hallway → room
```

### Floor Plan Pipeline
```
Upload image per floor
  → Stored as reference overlay
  → Admin traces rooms/hallways over image
  → Same trace → graph pipeline
  → Floor plan is NOT the navigation layer; vectors are
```

## 4. API Surface

### Existing (keep)
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/graph?campus_id=X` | Fetch graph snapshot |
| POST | `/api/graph` | Upsert full graph snapshot |

### New (V1)
| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/floor-plans` | Upload floor plan → URL |
| GET | `/api/buildings?campus_id=X` | List buildings (info panels) |
| GET | `/api/route?from=X&to=Y` | Public route query |

Entity CRUD remains client-side (Zustand) with snapshot-based persistence. No per-entity REST endpoints in V1.

## 5. Edge Types (Extending NavEdge)

| Type | Value | Usage |
|------|-------|-------|
| WALK | `"walk"` | Hallways, corridors, outdoor paths (default) |
| TRANSITION | `"transition"` | Outdoor→entrance, entrance→hallway, floor-to-floor |
| RESTRICTED | `"restricted"` | Faculty/admin-only zones |

## 6. V1 Scope

### Included
- NAVI Studio (single workspace with 3-panel layout)
- Buildings + floors + rooms (polygon-based)
- Floor plan upload + tracing
- Trace → auto node/edge generation
- Unified graph (indoor + outdoor)
- Asset placement (stairs, elevators, etc.)
- QR + Panorama markers
- Public navigation mode (A* routing on OSM)
- Exploration mode (virtual position, limited)

### Explicitly Excluded (V2+)
- Terrain / elevation / slope
- 2.5D building extrusions
- Mobile mapper
- GPX import/export
- GeoJSON exchange
- AI-assisted tracing

### Removed from Default Workflow
- Manual `add_node` / `add_edge` tools (hidden as advanced option for entrances/gates/anchors only)
- Component mode (replaced by studio tools)
- Classic SVG view (deprecated)

## 7. Reference → Vector → Published

```
Reference Layer (OSM / Satellite / Floor Plan Image)
    ↓  Trace over
Vector Layer (Rooms, Hallways, Buildings, Assets)
    ↓  Auto-compile
Navigation Graph (Nodes + Edges + Weights)
    ↓  Query
Published Map (Route rendering, Directory, Search)
```

Vectors are always the source of truth.
