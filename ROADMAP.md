# NAVI Product Completion Roadmap

This roadmap replaces the earlier architecture-phase milestones (M3.x). From here on, all work is organized by **product capability** — what a user can do — not by subsystem.

## Current Phase

```
✅ M1 — Core Types
✅ M2 — Compiler Pipeline
✅ M3 — Package Format & Publisher
✅ M4 — Plugin System
✅ M5 — Runtime Pipeline
🟡 M6 — Runtime Services
⬜ M7 — User Application
⬜ M8 — Studio UX
```

> M5 (Runtime Pipeline) tagged `v0.13-runtime-pipeline-complete`. Pipeline APIs are frozen — see `docs/architecture/pipeline-overview.md`.

---

## P1 — Complete NAVI Studio

**Exit criteria:** An administrator can create a campus from scratch, publish it, and no critical validation errors remain.

**Goal:** An administrator can author an entire campus without leaving NAVI Studio.

### Campus Authoring
- [ ] Create, open, save campuses
- [ ] Set campus metadata (name, coordinate system, default settings)
- [ ] Draw campus boundary

### Building Authoring
- [ ] Add, remove, rename buildings
- [ ] Set building position and footprint
- [ ] Upload floor plan images per building
- [ ] Calibrate floor plan images to real-world coordinates

### Floor Authoring
- [ ] Add, remove, reorder floors
- [ ] Set floor elevation and label
- [ ] Upload floor plan per floor

### Room Authoring
- [ ] Trace room boundaries (polygon tool)
- [ ] Name and categorize rooms (classroom, office, lab, restroom, etc.)
- [ ] Edit room properties
- [ ] Move, resize rooms

### Hallway / Corridor Authoring
- [ ] Trace hallway paths
- [ ] Connect hallways to rooms (entrance placement)
- [ ] Edit hallway width and properties

### Road / Path Authoring
- [ ] Draw roads between buildings
- [ ] Connect roads to building entrances
- [ ] Edit road properties (width, type)

### Indoor Transitions
- [ ] Place stairs between floors
- [ ] Place elevators between floors
- [ ] Connect transition endpoints to hallways

### Asset Management
- [ ] Place QR markers at room entrances and key locations
- [ ] Place panoramas at decision points
- [ ] Edit asset properties

### Validation & Auto Fix
- [ ] Run validation on demand (Problems Panel)
- [ ] See categorized warnings and errors
- [ ] Apply auto-fix suggestions
- [ ] Incremental validation during editing

### Publishing
- [ ] One-click publish from the Studio
- [ ] Preview published artifacts
- [ ] View manifest with checksums and schema version

### Studio Polish
- [ ] Keyboard shortcuts for all tools
- [ ] Undo/redo across all operations
- [ ] Zoom, pan, snap grid on canvas
- [ ] Inspector panel for selected entity
- [ ] Workflow progress indicator

---

## P2 — Complete NAVI Runtime

**Exit criteria:** A visitor can successfully navigate any route within the published ASU campus using Search, QR, or direct destination selection.

**Goal:** A visitor can successfully navigate from anywhere to anywhere.

### Search
- [ ] Search by room name, building name, POI name
- [ ] Search results with type badges and location context
- [ ] Empty state and error handling

### Routing
- [ ] Route between any two searchable points
- [ ] Route within a building (room-to-room)
- [ ] Route between buildings (via roads)
- [ ] Route across floors (via stairs/elevators)
- [ ] Turn-by-turn instruction list with distance
- [ ] Step-by-step route guidance UI

### QR Navigation
- [ ] Scan QR code → identify current location
- [ ] QR → search → route flow
- [ ] QR → direct route to destination

### Floor Switching
- [ ] Floor selector UI
- [ ] Visual floor plan display per floor
- [ ] Floor automatically switches during route progression

### Panorama
- [ ] Display panorama at decision points
- [ ] Hotspots in panoramas for next-step navigation
- [ ] Load panoramas from published artifact bundle

### GPS Integration
- [ ] Resolve GPS coordinates to nearest graph node
- [ ] Fall back to QR when GPS is inaccurate indoors

### Offline
- [ ] Published bundle loads from local storage
- [ ] Route computation without network
- [ ] Cache search index locally

### Mobile UX
- [ ] Responsive layout for phone screens
- [ ] Touch-friendly controls for route interaction
- [ ] QR scanner integration (camera API)

---

## P3 — Complete ASU Dataset

**Exit criteria:** The ASU-Ibajay campus is fully mapped, validated, and publishable without critical errors.

**Goal:** The real ASU campus is mapped with accurate data — no placeholders.

### Buildings
- [ ] All campus buildings mapped with correct footprints
- [ ] Floor plans uploaded and calibrated per building
- [ ] Room boundaries traced per floor
- [ ] Room names and categories match real data

### Connections
- [ ] Roads drawn between all buildings
- [ ] Entrances placed at correct locations
- [ ] Stairs and elevators placed per floor

### Assets
- [ ] QR markers at major entrances and room clusters
- [ ] Panoramas at key decision points
- [ ] POI data for campus services

### Verification
- [ ] Every building publishes without validation errors
- [ ] Every building-to-building route resolves
- [ ] Spot-check accuracy against physical campus

---

## P4 — Evaluation

**Exit criteria:** Evaluation data is complete and sufficient for inclusion in the thesis.

**Goal:** Collect thesis-quality metrics demonstrating NAVI's effectiveness.

### Usability
- [ ] Conduct usability tests with real users
- [ ] Measure task completion time (admin + visitor)
- [ ] Record error rates and recovery

### Accuracy
- [ ] Verify route correctness against physical campus
- [ ] Measure GPS-to-node resolution accuracy
- [ ] Compare published paths to actual walking paths

### Performance
- [ ] Measure Studio responsiveness with full ASU dataset
- [ ] Measure runtime load time for full campus bundle
- [ ] Measure route computation time (worst-case distance)
- [ ] Measure offline bundle size

### Analysis
- [ ] Compile results into structured report
- [ ] Identify bottlenecks and improvement areas
- [ ] Document known limitations

---

## P5 — Release

**Exit criteria:** NAVI v1 is deployable and all thesis deliverables are complete.

**Goal:** NAVI v1.0 is deployed, documented, and ready for thesis submission.

### Deployment
- [ ] Production deployment configuration
- [ ] Build and deploy pipeline
- [ ] HTTPS and security configuration
- [ ] Backup and recovery procedures

### Monitoring
- [ ] Error tracking and logging
- [ ] Usage analytics (opt-in)
- [ ] Performance monitoring

### Documentation
- [ ] Administrator manual (how to map a campus)
- [ ] Visitor quick-start guide
- [ ] Deployment guide
- [ ] Developer guide (architecture overview)
- [ ] API documentation if applicable

### Thesis Artifacts
- [ ] Thesis document with methodology and results
- [ ] Companion repository with evaluation data
- [ ] Screenshots and diagrams
- [ ] Demo video

---

## Milestone Tags

| Tag | Meaning |
|-----|---------|
| `walking-skeleton-v1` | ✅ Pipeline proven end-to-end |
| `studio-feature-complete` | P1 all items checked |
| `runtime-feature-complete` | P2 all items checked |
| `asu-campus-complete` | P3 all items checked |
| `thesis-release-v1.0` | Project complete |
