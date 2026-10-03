# Spatial Editing Workflow

> Defines how an author interacts with each editor tool to build a campus.
> All tools produce commands — they never mutate the document directly.

## Tool Architecture

Every editing tool follows the same lifecycle:

```
Activate → Preview (pointermove) → Commit (pointerdown/click) → Finish (dblclick/Enter/Escape)

       Previews: temporary geometry on canvas, snap indicators, validation hints
       Commits:  dispatches command → CampusDocument → renderer re-reads
       Finish:   finalizes entity, dispatches final command, transitions to SelectTool
       Cancel:   Escape discards in-progress entity, transitions to SelectTool
```

## Building Workflow

```
1. Activate DrawBuildingTool
2. Click vertices on map to define footprint polygon
3. Live rubber-band preview between last vertex and cursor
4. Snap to: grid, other building vertices, road endpoints
5. Double-click or Enter to finish (auto-closes polygon)
6. Escape to cancel entire operation
7. On finish:
   a. Validate polygon (≥3 points, closed, no self-intersection)
   b. Dispatch building.create command
   c. CampusDocument updated
   d. Default properties: name="Building N", code="B-N", category="other"
   e. Switch to SelectTool with new building selected
   f. Properties panel opens for naming
```

### Visual feedback during drawing

| State | Visual |
|-------|--------|
| Hover (no vertices) | Crosshair cursor |
| Placing vertices | Dashed polygon outline, vertex dots |
| Rubber-band | Dashed line from last vertex to cursor |
| Snap | Snap indicator dot + highlight, distance label |
| Validation error | Red outline, tooltip with error message |

## Room Workflow

```
Precondition: activeBuildingId and activeFloorId must be set
              (floor plan image recommended but not required)

1. Activate DrawRoomTool
2. Click vertices on floor plan to define room polygon
3. Live rubber-band preview
4. Snap to: grid, building footprint, wall intersections, room adjacency
5. Double-click or Enter to finish (auto-closes polygon)
6. Escape to cancel
7. On finish:
   a. Validate polygon (≥3 points, closed, no self-intersection, inside building footprint)
   b. Dispatch room.create command
   c. Default properties: name="Room N", number=auto-increment, category="other"
   d. Switch to SelectTool with new room selected
```

## Hallway Workflow

```
Precondition: activeFloorId set

1. Activate DrawHallwayTool
2. Click points to define hallway centerline (polyline)
3. Width defaults to 3m, adjustable in properties
4. Snap to: room entrances, other hallway endpoints, grid
5. Single-click adds vertex, Enter or dblclick finishes
6. Escape to cancel
7. On finish:
   a. Validate polyline (≥2 points)
   b. Dispatch hallway.create command
   c. Default properties: name="Hallway N", width=3
```

## Road Workflow

```
1. Activate DrawRoadTool
2. Click points to define road centerline (polyline in world coords)
3. Width defaults to 6m, adjustable
4. Snap to: building entrances, road intersections, grid
5. On finish:
   a. Validate polyline (≥2 points)
   b. Dispatch road.create command
   c. Default properties: name="Road N", width=6, surface="paved"
```

## Entrance Workflow

```
Precondition: activeFloorId set (building level context)

1. Activate PlaceEntranceTool
2. Hover near building footprint edge or room wall
3. Wall segment highlights, shows snap point on edge midpoint
4. Click to place entrance
5. Compute orientation (perpendicular to wall, pointing outward)
6. On place:
   a. Validate entrance is on polygon boundary
   b. Dispatch entrance.create command
   c. Default type="side", label="Entrance N"
```

## Staircase Workflow

```
Precondition: activeBuildingId set

1. Activate PlaceStaircaseTool
2. Click on floor to place staircase position
3. Fill: fromLevel, toLevel, type (open/enclosed/emergency)
4. On place:
   a. Dispatch staircase.create command
   b. Default type="open"
```

## Elevator Workflow

```
Precondition: activeBuildingId set

1. Activate PlaceElevatorTool
2. Click on floor to place elevator position
3. Fill: fromLevel, toLevel
4. On place:
   a. Dispatch elevator.create command
```

## Panorama Workflow

```
1. Activate PlacePanoramaTool
2. Click on map/canvas to place panorama
3. Upload 360° image (asset manager)
4. Set initial heading
5. Add hotspots (click in panorama viewer, link to target)
6. On place:
   a. Dispatch panorama.create command
   b. Image uploaded to asset manager
```

### Hotspot editing

```
1. Open panorama hotspot editor
2. Click in 360° view to place hotspot
3. Set target type: panorama | room | entrance | url
4. Set target ID
5. Set label
6. Hotspot is stored as part of panorama entity
```

## QR Checkpoint Workflow

```
1. Activate PlaceQRCodeTool
2. Click on map to place QR checkpoint
3. Assign unique code
4. Connect to navigation node (optional, auto-detect nearest)
5. On place:
   a. Dispatch qr.create command
```

## Floor Manager

```
Available from Layers panel or toolbar

Operations:
├── Add floor (level = N+1, label = auto)
├── Rename floor
├── Duplicate floor (copies rooms, hallways; new IDs)
├── Delete floor (with entity existence check)
├── Reorder floor (change level number)
├── Toggle visibility (show/hide on canvas)
├── Toggle lock (prevent edits)
└── Set active floor (determines what's rendered/edited)
```

### Active floor rules

- Exactly one floor is active per building at a time
- Active floor determines which rooms/hallways are visible and editable
- Switching buildings also switches active floor to the last-active floor for that building
- Room/hallway/entrance tools require an active floor
- If active floor has no plan image, show building footprint + room outlines

## Canvas Rendering

```
Canvas renders in z-order (bottom to top):

1. Base map tiles (MapLibre GL)
2. Floor plan images (calibrated)
3. Building footprints (filled, per-building color)
4. Room polygons (filled, per-category color)
5. Hallway polylines (with width visualization)
6. Road polylines (with width visualization)
7. Entrance markers (door icon)
8. Staircase markers (stair icon)
9. Elevator markers (elevator icon)
10. Panorama markers (camera icon)
11. QR markers (QR icon)
12. Selection overlays (highlight, handles)
13. Validation overlays (error/warning icons)
14. Hover highlight
15. Tool preview geometry (dashed, semi-transparent)
```

### Selection rendering

| State | Visual |
|-------|--------|
| Selected | Blue highlight, transform handles at vertices |
| Hovered | Lighter highlight, cursor changes |
| Active tool preview | Dashed lines, semi-transparent fill |
| Validation error | Red border + error icon |

## Interaction Model

```
Mouse/Touch                Tool                    Command Pipeline           Document            Renderer
    │                       │                          │                       │                   │
    │── pointerdown ───────>│                          │                       │                   │
    │                       │── preview geometry ──────│───────────────────────│──────────────────>│
    │<── snap indicator ────│                          │                       │                   │
    │── pointermove ───────>│                          │                       │                   │
    │                       │── update preview ────────│───────────────────────│──────────────────>│
    │── click ─────────────>│                          │                       │                   │
    │                       │── build.create ─────────>│                       │                   │
    │                       │                          │── validate ──────────>│                   │
    │                       │                          │── execute ───────────>│                   │
    │                       │                          │                       │── snapshot ──────>│
    │                       │                          │── post-hooks ────────>│                   │
    │                       │                          │                       │── event ─────────>│
    │                       │                          │                       │                   │── re-render
```

## Error Prevention

| Error | Prevention |
|-------|------------|
| Place entity outside bounds | Validate bounds before commit |
| Self-intersecting polygon | Run polygon-closure + self-intersection validation on preview |
| Duplicate IDs | Auto-generate IDs (cuid2), validate uniqueness |
| Entrance not on boundary | Snap entrance to nearest wall edge |
| Missing active floor | Disable room/hallway/entrance tools if no active floor |
| Orphan entities | Cascade delete: building → floors → rooms |
| Invalid asset reference | Validate asset exists before commit |

## Tool Transitions

```
SelectTool
  ├── Activate DrawBuildingTool → user draws → finish → SelectTool
  ├── Activate DrawRoomTool → user draws → finish → SelectTool
  ├── Activate DrawHallwayTool → user draws → finish → SelectTool
  ├── Activate DrawRoadTool → user draws → finish → SelectTool
  ├── Activate PlaceEntranceTool → user places → finish → SelectTool
  ├── Activate PlaceStaircaseTool → user places → finish → SelectTool
  ├── Activate PlaceElevatorTool → user places → finish → SelectTool
  ├── Activate PlacePanoramaTool → user places → finish → SelectTool
  ├── Activate PlaceQRCodeTool → user places → finish → SelectTool
  └── Escape → remains in SelectTool (no-op)

Any tool:
  ├── Escape → cancel in-progress → SelectTool
  └── Activate different tool → cancel in-progress → activate new tool
```
