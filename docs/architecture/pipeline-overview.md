# NAVI Pipeline Architecture

> Frozen at M5 — Runtime Pipeline complete (v0.13)

## Data Flow

```
Studio
   │
   ▼
CampusDocument
   │
   ▼
Compiler  (@navi/compiler)
   │
   ▼
NavigationArtifacts
   │
   ▼
Publisher  (@navi/compiler/publisher)
   │
   ▼
NavigationPackage
   │
   ▼
Loader  (@navi/runtime)
   │
   ▼
LoadedPackage
   │
   ▼
RuntimeEngine  (@navi/runtime)
   │
   ├── Routing (A*)
   ├── Search (fuzzy match)
   ├── Positioning (GPS + entrance resolver)
   └── Building Queries
```

## Layer Responsibilities

| Layer | Package | Input | Output |
|-------|---------|-------|--------|
| Compiler | `@navi/compiler` | `CampusDocument` | `NavigationArtifacts` (graph, search index, POI, buildings) |
| Publisher | `@navi/compiler/publisher` | `NavigationArtifacts` | `NavigationPackage` (serialized artifacts + manifest) |
| Loader | `@navi/runtime` | `NavigationPackage` (file system or memory) | `LoadedPackage` (validated, hydrated) |
| Runtime | `@navi/runtime` | `LoadedPackage` | `RuntimeEngine` (routing/search/positioning APIs) |

## Frozen Public APIs

These APIs are stable. Only bug fixes accepted without a new ADR.

### Compiler (`@navi/compiler`)

- `compile()` — legacy one-shot compilation
- `CampusCompiler` — plugin-based compilation pipeline
- `NavigationArtifacts` — compiler output type
- `CompilerReport` — compilation statistics

### Publisher (`@navi/compiler/publisher`)

- `publish()` — writes artifacts + manifest to disk
- `NavigationPackage` — published package type
- `PublishResult` — publish outcome

### Loader (`@navi/runtime`)

- `load()` — load from file system
- `LoadedPackage` — validated in-memory package
- `LoadResult` — success/failure discriminated union

### Runtime (`@navi/runtime`)

- `RuntimeEngine` — top-level orchestrator
- `RoutingEngine` — A* pathfinding
- `SearchEngine` — fuzzy search
- `PositionEngine` — GPS resolution
