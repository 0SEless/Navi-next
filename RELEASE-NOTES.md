# v1.0.0 — NAVI Campus Navigation Platform

Initial release of the NAVI indoor/outdoor navigation platform for multi-campus management.

## Features

### Core Platform
- **Campus Document** — structured format for buildings, floors, rooms, roads, and amenities
- **Compiler** — transforms campus documents into navigation graphs with search indices, POI data, and building indexes
- **Runtime Engine** — loads compiled artifacts and provides search, routing, GPS positioning, and turn-by-turn navigation
- **A\* Routing** — weighted pathfinding with distance and duration estimates
- **Full-text Search** — room/building search by name, type, tags, and aliases with relevance scoring

### Deployment
- **Publish Pipeline** — one-command compile → artifact generation → deploy directory
- **4 Deployment Profiles** — development, production, offline, demo
- **Release Validation** — 28-point integrity check (manifest, checksums, JSON validity, artifact existence)
- **Artifact Loader** — HTTP-based artifact loading with caching

### Tools & Scripts
- `npm run compile <campus.json>` — compile campus document to navigation graph
- `npm run publish <campus.json> [profile]` — full publish pipeline
- `npm run validate [directory]` — release integrity validation
- `npm run demo <campus.json>` — end-to-end demonstration
- `npm run benchmark` — performance benchmarks
- `npm run stress` — stress tests (500–5000 rooms)

### Extensibility
- Extractor framework for custom campus data sources
- Publisher interface for custom output formats
- TypeScript-first architecture with full type exports

## Statistics
- **585 unit/integration tests** — all passing
- **28 release validation checks** — all passing
- **Compile time**: ~2ms for 3-building, 24-room campus
- **A\* routing**: ~45ms for 5000-node graph
- **Demo**: full pipeline from campus document to turn-by-turn navigation

## Installation

```bash
npm install @navi/core @navi/compiler @navi/runtime
```

## Quick Start

```bash
# Compile a campus document
npm run compile campus.json

# Full publish pipeline
npm run publish campus.json production

# Run demo
npm run demo campus.json
```
