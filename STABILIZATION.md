# M3.5 — Platform Stabilization & Regression Recovery

**Goal**: Restore architectural guarantees after agent regressions.
Any map created in NAVI can be saved, loaded, compiled, published, routed, and edited again without data loss.

---

## Stabilization Board

| ID    | Issue                       | Layer      | Severity    | Test Written | Fixed | Verified |
|-------|-----------------------------|------------|-------------|:---:|:---:|:---:|
| S-001 | Lossy save pipeline         | Data       | 🔴 Critical | ✅ | ✅ | ✅ |
| S-002 | Undo after delete           | Editor     | 🔴 Critical | ⬜ | ⬜ | ⬜ |
| S-003 | GraphAdapter unstable IDs   | Editor     | 🟠 High     | ✅ | ⬜ | ⬜ |
| S-004 | Footprint transform drift   | Compiler   | 🔴 Critical | ⬜ | ⬜ | ⬜ |
| S-005 | Selection loop              | Editor     | 🔴 Critical | ⬜ | ⬜ | ⬜ |
| S-006 | Delete cascade orphans      | Data       | 🟠 High     | ⬜ | ⬜ | ⬜ |
| S-007 | Incremental validation stale| Validation | 🟠 High     | ⬜ | ⬜ | ⬜ |
| S-008 | Disconnected graph publish  | Compiler   | 🔴 Critical | ⬜ | ⬜ | ⬜ |
| S-009 | Duplicate floor IDs         | Data       | 🟠 High     | ⬜ | ⬜ | ⬜ |
| S-010 | Autosave race               | Save       | 🔴 Critical | ⬜ | ⬜ | ⬜ |

---

## Execution Order

1. **S-001** — Protects user data above all
2. **S-008** — Prevents publishing invalid navigation data
3. **S-010** — Prevents stale writes / history corruption
4. **S-002** — Undo/delete reliability
5. **S-004** — Coordinate/footprint round-trip
6. **S-003** — Stable GraphAdapter IDs
7. **S-006** — Cascade cleanup for deletions
8. **S-007** — Incremental validation correctness
9. **S-009** — ID collision fixes
10. Performance & cleanup

---

## S-001 — Lossy Save Pipeline

### Status
✔ **Serialization omissions fixed** — 7 bugs identified and patched.
⚠ **GraphAdapter architectural debt remains** — legacy graph model (`Building.floors: number[]`) is fundamentally incompatible with `CampusDocument.Floor[]`. The `floorData` bridge works but the long-term fix is to remove GraphAdapter from the persistence path entirely.

### Fixed Bugs (2026-07-16)

| # | Bug | Root | Fix |
|---|-----|------|-----|
| 1 | Building `department` lost | Not stored in LegacyBuilding | Added field |
| 2 | Floor identity lost (id/label/metadata) | Graph stores `floors: number[]` only | `floorData` bridge on Building |
| 3 | Room `number` always empty | Component type lacks field | Store in metadata |
| 4 | Hallway `width` = 2 instead of 3 | Component type lacks field | Store in metadata |
| 5 | Staircase type hardcoded `'open'` | Component type lacks field | Store in metadata |
| 6 | Panorama `floor: 0` → undefined | `\|\|` treats 0 as falsy | `??` instead |
| 7 | QR id replaced by `genId('N')` | sync() generates new IDs | Store `qrId` in metadata |

### Files Modified
- `packages/editor/src/graph-adapter.ts` — store department, floorData, metadata per entity type, qrId
- `packages/editor/src/context/create-editor-context.ts` — read back stored metadata, fix panorama `\|\|`, add `nodePosition()` helper
- `src/types/nav-types.ts` — add `floorData`, `aliases`, `metadata` to Building interface

### Test Coverage
- `packages/editor/src/__tests__/data-round-trip.test.ts` — 23 tests: 13 pure JSON round-trip + 10 full GraphAdapter pipeline round-trip covering every entity type and field
- All 23 pass

### Remaining Architectural Debt
- GraphAdapter still exists in the persistence path (`campus-loader.ts`)
- The legacy graph model has no concept of `Floor` as a rich entity
- Future: after legacy load path is removed, CampusDocument should serialize/deserialize directly without GraphAdapter intermediate
