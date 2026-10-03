# Package APIs

> Generated 2026-07-15 — comprehensive survey of every exported symbol across @navi/core, @navi/compiler, @navi/editor, and @navi/runtime.

---

## 1. @navi/core

**Location:** packages/core/src/index.ts
**Entry:** re-exports from 4 sub-modules

### Exported Types

| Symbol | Defined in | Kind |
|---|---|---|
| LatLng | 	ypes/coordinates | Interface |
| LatLngElevation | 	ypes/coordinates | Interface |
| LocalCoord | 	ypes/coordinates | Interface |
| WorldPolygon | 	ypes/coordinates | Interface |
| LocalPolygon | 	ypes/coordinates | Interface |
| WorldPolyline | 	ypes/coordinates | Interface |
| LocalPolyline | 	ypes/coordinates | Interface |
| latLngEquals(a,b) | 	ypes/coordinates | Function |
| localCoordEquals(a,b) | 	ypes/coordinates | Function |
| BuildingCategory | 	ypes/enums | Union type |
| RoomCategory | 	ypes/enums | Union type |
| EntranceType | 	ypes/enums | Union type |
| StaircaseType | 	ypes/enums | Union type |
| RoadSurface | 	ypes/enums | Union type |
| RoadType | 	ypes/enums | Union type |
| Building | 	ypes/entities | Interface |
| Floor | 	ypes/entities | Interface |
| Room | 	ypes/entities | Interface |
| Hallway | 	ypes/entities | Interface |
| Staircase | 	ypes/entities | Interface |
| Elevator | 	ypes/entities | Interface |
| Entrance | 	ypes/entities | Interface |
| Road | 	ypes/entities | Interface |
| Panorama | 	ypes/entities | Interface |
| PanoramaHotspot | 	ypes/entities | Interface |
| QRCheckpoint | 	ypes/entities | Interface |
| DocumentMetadata | 	ypes/document | Interface |
| EntityChange | 	ypes/document | Interface |
| CampusDocument | 	ypes/document | Interface |
| ecordChange(doc, change) | 	ypes/document | Function |
| getChangesSince(doc, version) | 	ypes/document | Function |

### Geometry (geometry/index.ts)

Re-exports from 8 sub-modules:

| Sub-module | Contents |
|---|---|
| polygon | Polygon area, centroid, contains-point, simplify, etc. |
| polyline | Polyline length, interpolation, simplification |
| spatial-index | R-tree or grid-based spatial index for entity lookup |
| spatial-query | Range queries, nearest-neighbor queries |
| project | World ↔ building-local projection helpers |
| extensions | Geometry extension utilities |
| 	opology | Topology checks (connectivity, adjacency) |
| snap | Point snapping to geometry (vertex, edge, grid) |

### Serialization (serialization/index.ts)

| Symbol | Source | Kind |
|---|---|---|
| *(re-exports serializer.ts)* | serializer | Functions for serializing/deserializing CampusDocument |

### Coordinates (coordinates/index.ts)

| Symbol | Source | Kind |
|---|---|---|
| CoordinateReferenceSystem / CRS | crs | Class or type |
| CoordinateTransformer | 	ransformer | Class — world↔building-local |
| Calibration helpers | calibration | Functions |

---

## 2. @navi/compiler

**Location:** packages/compiler/src/index.ts
**Entry:** re-exports from 5 sub-modules
**Subpath export:** @navi/compiler/publisher → src/publisher/index.ts

### Main exports (@navi/compiler)

| Symbol | Source | Kind |
|---|---|---|
| compile(document, config) | compiler | Function (legacy/deprecated) |
| CampusCompiler | compiler | Class (new, plugin-based) |
| generateArtifacts(campus, extraction) | rtifacts | Function |
| generateManifest(...) | rtifacts | Function |
| uildGraph(document, extraction) | rtifacts | Function |
| uildSearchIndex(document, graph) | rtifacts | Function |
| uildPOIData(graph) | rtifacts | Function |
| uildBuildingIndex(document, graph) | rtifacts | Function |
| ccessibilityWeightPlugin | plugins | Plugin instance |
| customValidationPlugin | plugins | Plugin instance |
| ParseStage | pipeline/stages | Class |
| parseDocument(...) | pipeline/stages | Function |
| BuildNodesStage | pipeline/stages | Class |
| uildNodes(...) | pipeline/stages | Function |
| BuildEdgesStage | pipeline/stages | Class |
| uildEdges(...) | pipeline/stages | Function |
| CampusConnectorStage | pipeline/stages | Class |
| connectCampuses(...) | pipeline/stages | Function |
| OptimizeStage | pipeline/stages | Class |
| optimizeGraph(...) | pipeline/stages | Function |
| ValidateStage | pipeline/stages | Class |
| alidateGraph(...) | pipeline/stages | Function |

### Exported Types (	ypes/index.ts)

| Type | Kind |
|---|---|
| BoundingBox, NavNodeType, NavNode, NavEdgeType, NavEdge, NavigationGraph | Core graph types |
| CompilerConfig, CompileReport, CompileResult, CompileResultV2 | Compile input/output |
| NavigationSpaceType, NavigationSpace, TransitionPointType, TransitionPoint, CorridorType, WalkableCorridor, ExtractionResult, ValidationResult | Extraction types |
| PublishedArtifact, PublishedManifest, SearchEntry, SearchIndex, POI, POIData, FloorEntry, BuildingEntry, BuildingIndex | Published artifact types |
| CompileStageId, PluginMode, CompilerStagePlugin, CompilerStageInput, CompilerStageOutput, CompilerStageNext, ParsedDocument, ParsedBuilding, ParsedRoom, ParsedHallway, ParsedEntrance, ParsedStair, ParsedElevator, ParsedRoad | Plugin system types |
| CompileStats, CompileWarning, CompileError, CompileStage | Progress/status types |

### Publisher subpath (@navi/compiler/publisher)

| Symbol | Kind |
|---|---|
| publish(campus, result, options) | Function — writes artifacts to disk + generates manifest |
| PublisherOptions | Interface |
| PublishedManifest | Interface (re-exported from types) |

---

## 3. @navi/editor

**Location:** packages/editor/src/index.ts
**Entry:** re-exports from 18 sub-modules

### Context

From context/index.ts:

| Symbol | Kind |
|---|---|
| ServiceRegistry, BaseEditorService | Classes |
| EditorService, EditorServiceContext, ServiceStatus, Capability, ServiceMap, ServiceAccessor | Types |
| EditorProvider, useEditor, serviceNames | React context |
| EditorContext | Type |
| createEditorContext(graph, adapter, compiler) | Factory function |
| DocumentStore | Class |
| EntityId, EntityType, EntitySelector, BuildingSelector, FloorSelector, RoomSelector, HallwaySelector, StaircaseSelector, ElevatorSelector, EntranceSelector, RoadSelector, PanoramaSelector, QRSelector, SelectionMode, SelectionState | Types |
| sEntityId, SelectionOrigin | Values |
| useSelection | React hook |
| SelectionBridge | Class |
| LegacySyncState, BridgeSyncTarget | Types |
| useWorkspace | React hook |
| WorkspaceMode, Workspace | Types (from projections) |
| indBuilding, indFloorByLevel, indFloorById, getBuildingFloors, getBuildingFloorCount, getFloorEntities, indRoom, indEntity, indComponent, FloorEntities, EntityResult | Selector functions |
| useDocumentSelector, useActiveBuilding, useBuilding, useFloorCount, useFloor, useBuildingFloors | React hooks |

### Event Bus

From eventbus.ts:

| Symbol | Kind |
|---|---|
| DocumentEventBus | Class (extends BaseEditorService) |
| EditorEventType | Union of ~20 event types |
| EditorEventPayload, EntityEventPayload, SelectionEventPayload, ToolEventPayload, ViewportEventPayload, DocumentEventPayload, TransactionFlushPayload | Payload types |
| EditorEventHandler | Callback type |

### Commands

From commands/index.ts:

| Symbol | Kind |
|---|---|
| CommandRegistry | Class |
| CommandDispatcher | Class |
| ExecuteOptions | Type |
| Command, CommandHandler, MutationResult, PreHook, PostHook | Types |
| uildingCreateHandler, uildingRenameHandler, uildingDeleteHandler | Command handlers |
| oomCreateHandler, oomRenameHandler, oomDeleteHandler | Command handlers |
| hallwayCreateHandler, hallwayRenameHandler, hallwayDeleteHandler | Command handlers |
| staircaseCreateHandler, staircaseDeleteHandler | Command handlers |
| elevatorCreateHandler, elevatorDeleteHandler | Command handlers |
| entranceCreateHandler, entranceDeleteHandler | Command handlers |
| oadCreateHandler, oadRenameHandler, oadDeleteHandler | Command handlers |
| panoramaCreateHandler, panoramaDeleteHandler | Command handlers |
| qrCreateHandler, qrDeleteHandler | Command handlers |
| loorCreateHandler, loorRenameHandler, loorDeleteHandler, loorDuplicateHandler | Command handlers |
| entityUpdateHandler | Command handler |

### History

| Symbol | Kind |
|---|---|
| HistoryStack | Class |
| HistoryEntry | Type |

### Tools

From 	ools/index.ts:

| Symbol | Kind |
|---|---|
| ToolRegistry | Class |
| Tool, ToolPointerEvent, ToolContext | Types |
| selectTool | Tool definition |
| panTool | Tool definition |
| placeEntranceTool | Tool definition |
| placeStaircaseTool | Tool definition |
| placeElevatorTool | Tool definition |
| placePanoramaTool | Tool definition |
| placeQrTool | Tool definition |
| calibrationTool | Tool definition (from panels) |
| drawBuildingTool | Tool definition |
| drawRoomTool | Tool definition |
| drawHallwayTool | Tool definition |
| drawRoadTool | Tool definition |

### Selection

| Symbol | Kind |
|---|---|
| SelectionManager | Class |
| SelectionState | Type |

### Viewport

| Symbol | Kind |
|---|---|
| Viewport | Class |
| ViewportCommand | Type |
| ViewportState | Type |

### Editing Context

| Symbol | Kind |
|---|---|
| EditingContextService | Class |
| EditorMode | Type |

### Canvas

| Symbol | Kind |
|---|---|
| MapCanvas | React component |

### Validation

From alidation/index.ts:

| Symbol | Kind |
|---|---|
| ValidationEngine | Class |
| ValidationSnapshot, ValidationIssue, ValidationStatistics, AnalysisCache, ValidationState | Types |
| uildSnapshot | Function |
| ValidationRule, ValidationContext, ValidationProfileId, ValidationProfile, ProfileConfig, ValidationAffinity | Types |
| getProfile, getProfiles, getDefaultProfile, esolveConfig | Functions |
| RuleProvider, RuleRegistry, DefaultRuleRegistry | Types/classes |
| AnalysisPass, GraphAnalysisPass, GeometryAnalysisPass, MetadataIndexPass, SpatialIndexPass | Classes |

### Shell

From shell/index.ts:

| Symbol | Kind |
|---|---|
| EditorShell | React component |
| MenuBar | React component |
| StatusBar | React component |

### Panels

From panels/index.ts:

| Symbol | Kind |
|---|---|
| LayersPanel | React component |
| ProblemsPanel | React component |
| FloorManager | React component |
| CalibrationPanel | React component |
| calibrationTool, computeCalibration, ddControlPoint, emoveLastControlPoint, createEmptyState | Tool + utilities |
| CalibrationState | Type |
| *(re-exports workflow/*)* | Workflow UI hooks/cards |
| *(re-exports properties/*)* | Property panel components for each entity type |

### Rendering

From endering/index.ts:

| Symbol | Kind |
|---|---|
| uildingsToGeoJSON(buildings) | Function |
| oadsToTracesGeoJSON(roads) | Function |
| documentToRenderingGeo(document) | Function |

Additional rendering constants/paint helpers (importable directly from @navi/editor):

| Path | Contents |
|---|---|
| endering/layers.ts | LAYER_IDS, SOURCE_IDS, BUILDING_CATEGORY_COLORS, ROOM_CATEGORY_COLORS, paint helper functions |
| endering/entity-renderer.ts | EntityRenderer for rendering individual entities on map |

### Projections

From projections/index.ts:

| Symbol | Kind |
|---|---|
| Explorer sub-module exports | Explorer projection types |
| ExplorerAdapter | Class |
| deriveWorkspace | Function |
| WorkspaceMode, Workspace | Types |

### Services

From services/index.ts:

| Symbol | Kind |
|---|---|
| NavigationCompiler | Class (stateless, delegates to CompilerAdapter) |
| CompileResult, CompiledArtifacts, CompilerAdapter | Types/Interface |
| PersistenceService | Class (wraps PersistenceAdapter) |
| PersistenceAdapter, PublishResult | Types/Interface |
| WorkflowStore | Class |
| WorkflowSnapshot, ValidationResult, SaveRecord, PublishRecord, SyncStatus | Types |
| WorkflowService | Class |
| AutosaveService | Class |
| AutosaveOptions | Type |
| PublishStore | Class |
| PublishState, PublishSnapshot | Types |
| PublishService | Class (orchestrates compile → validate → publish) |

### Other classes

| Symbol | File | Kind |
|---|---|---|
| AssetManager | sset-manager.ts | Class |
| AssetEntry | sset-manager.ts | Interface |
| GraphAdapter | graph-adapter.ts | Class (syncs CampusDocument ↔ legacy Graph) |
| getDemoCampus() | demo-campus.ts | Function — returns a full demo CampusDocument |

---

## 4. @navi/runtime

**Location:** packages/runtime/src/index.ts

### Exports

| Symbol | Source | Kind |
|---|---|---|
| RuntimeEngine | engine | Class — top-level runtime orchestrator |
| DataAPI | engine | Class |
| SearchAPI | engine | Class |
| RoutingAPI | engine | Class |
| PositionAPI | engine | Class |
| NotImplementedError | engine | Error class |
| SearchEngine | search | Class |
| RoutingEngine | outing | Class |
| AStar | outing | Class — A* pathfinding |
| PositionEngine | position | Class |
| GpsResolver | position | Class |

### Exported Types

| Type | Source |
|---|---|
| SearchResult, SearchConfig | search |
| Route, RouteStep, Instruction, InstructionType | outing |
| CurrentPosition | position |
| NavigationGraph, SearchIndex, POIData, BuildingIndex, BuildingEntry, NavNode, NavEdge, BoundingBox | Re-exported from @navi/compiler |

---

## 5. Gaps Analysis

What a new pps/studio-new/ would still need to write (not provided by any package):

### Category A: Must Write (no package provides)

| # | Gap | Why it is not in a package |
|---|---|---|
| 1 | **Auth system** — AuthProvider, useAuth, login page, mock auth, Supabase auth integration | Auth is app-specific; no universal auth package exists |
| 2 | **Persistence adapter implementations** — localStorage save/load, Supabase sync for graph data and campus-map metadata | The PersistenceAdapter interface is in @navi/editor but implementations use app-specific schema |
| 3 | **API route handlers** — /api/compile (server-side compiler), /api/graph (CRUD), /api/publish, /api/buildings, /api/campus-maps | Next.js App Router handlers; packaging would couple to framework |
| 4 | **MapLibre map creation & style management** — 
ew maplibregl.Map({...}), base style switching (OSM ↔ Satellite), style.load handling | @navi/editor has MapCanvas but it assumes the map is already created |
| 5 | **GeoJSON source/layer registration** — ddSourcesAndLayers() creating MapLibre sources for buildings, rooms, roads, nodes, edges, drawing, traces | Packages provide layer constants + paint helpers but NOT the map.addSource/map.addLayer calls |
| 6 | **Map event → tool wiring** — InteractionController translating MapLibre click/dblclick/mousedown/mousemove/mouseup/keydown into tool actions | Tool definitions exist in @navi/editor but the map event integration is app-layer |
| 7 | **EditorBridge** — creates editor context from persisted document, wires SelectionBridge to legacy stores, manages context lifetime | Bridges the app's persistence layer to the editor package |

### Category B: Partially in Packages, Partially App

| # | Component | In packages | App-specific |
|---|---|---|---|
| 8 | **StudioCanvas** | MapCanvas, DocumentEventBus, ToolRegistry | Full component composition: MapRenderer + ViewportController + InteractionController + overlays |
| 9 | **StudioToolbar** | EditingContextService, ToolRegistry, Viewport, HistoryStack, WorkflowService | HTML/CSS layout, icon selection, mode switching UI, save/publish buttons |
| 10 | **MapRenderer** | uildingsToGeoJSON, oadsToTracesGeoJSON, LAYER_IDS, SOURCE_IDS, paint helpers | All MapLibre source/layer creation, data sync (setData), visibility toggles, style switching |
| 11 | **SelectionOverlay** | SelectionManager, useSelection hook | MapLibre setFeatureState calls wired to selection state |
| 12 | **DrawingOverlay** | DocumentEventBus | MapLibre setData for ephemeral drawing geometry |
| 13 | **PropertiesPanel** | **Fully provided** as @navi/editor component | Nothing — ready to import |
| 14 | **ExplorerPanel** | useDocumentSelector, useActiveBuilding, selectors | React tree rendering, context menu, actions |
| 15 | **Validation** | ValidationEngine, rules, profiles | Nothing — fully extractable |
| 16 | **Workflow UI** | WorkflowService, PublishService, AutosaveService | UI shells (workflow-card, use-publish, use-workflow hooks) |

### Category C: Legacy Replacements (packages replace old src/ code)

| Legacy file | Package replacement |
|---|---|
| src/engine/graph.ts (Graph class) | @navi/core types + @navi/editor DocumentStore |
| src/engine/component-compiler.ts | @navi/compiler (CampusCompiler) |
| src/engine/a-star.ts | @navi/runtime (AStar + RoutingEngine) |
| src/engine/graph-validator.ts | @navi/editor ValidationEngine |
| src/engine/geometry.ts | @navi/core geometry |
| src/engine/intersection-engine.ts | @navi/core geometry/topology |
| src/engine/spatial-resolver.ts | @navi/core spatial-index/spatial-query |
| src/types/nav-types.ts | @navi/core types |
| src/types/studio-types.ts | @navi/editor EditorMode + tool types |

### Category D: App-Only (not suitable for extraction)

| # | Item | Reason |
|---|---|---|
| 17 | **StudioDashboard** — map list / create-map UI | App-level page composition |
| 18 | **AppLayout** — sidebar navigation | App shell, branding, screen routing |
| 19 | **Public-facing pages** — PublicMap, PanoramaViewer, QRScanner, RouteLine | Consumer features, not editor |
| 20 | **CampusMap / campus-map-store** | Legacy "campus map" abstraction |
| 21 | **CSS / globals.css** | App-level styling |

---

## 6. Dependency Graph

`
@navi/core          (zero deps)
      ↑
@navi/compiler      (depends on @navi/core)
      ↑
@navi/editor        (depends on @navi/core, peer: react, maplibre-gl)
      ↑
@navi/runtime       (depends on @navi/core + @navi/compiler, zero react deps)
`

Note: @navi/editor does NOT depend on @navi/compiler — compilation is injected via CompilerAdapter to avoid bundling Node built-ins.

---

## 7. Export Statistics

| Package | Named exports | Types | Functions/Classes | React components |
|---|---|---|---|---|
| @navi/core | ~35 | ~25 | ~10 | 0 |
| @navi/compiler | ~25 | ~35 | ~18 | 0 |
| @navi/editor | ~120 | ~60 | ~40 | ~12 |
| @navi/runtime | ~15 | ~15 | ~10 | 0 |
