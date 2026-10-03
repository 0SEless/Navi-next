# SV1 — Studio Validation

**Type:** Product milestone (not architecture)
**Purpose:** Prove NAVI Studio is usable by someone who didn't build it
**Go / No-Go Gate:** Before M8 (Application Integration)

---

## Deliverables

| # | Artifact | What |
|---|----------|------|
| SV1.0 | Canonical Scenario | One golden path every release must support |
| SV1.1 | Feature Audit | Which steps exist, are usable, need UX, or are missing |
| SV1.2 | Validation Checklist | Acceptance test — per-step outcome, time, confusion |
| SV1.3 | UX Backlog | Evidence-based prioritised issues |

---

## SV1.0 — Canonical Authoring Scenario

### Goal

Publish a complete navigable campus from an empty project, then verify navigation works.

### Steps

```
  1. Create a new campus
  2. Configure campus metadata (name, code, CRS)
  3. Draw campus boundary polygon
  4. Add building
  5. Configure building metadata (name, code, category)
  6. Upload floor plan image
  7. Calibrate floor plan (pixel ↔ world)
  8. Trace hallways (polyline)
  9. Create rooms (polygon)
 10. Place entrances on building perimeter
 11. Place stairs between floors
 12. Place elevators between floors
 13. Add QR markers
 14. Add panorama nodes
 15. Trace roads between buildings
 16. Run validation
 17. Fix all validation errors
 18. Publish
 19. Inspect published runtime package
 20. Open preview
 21. Verify navigation (locate, search, route, arrive)
```

---

## SV1.1 — Feature Audit

### Legend

| Icon | Meaning |
|------|---------|
| ✅ | Exists and usable in current Studio |
| ⚠️ | Exists but has UX friction |
| 🔧 | Needs implementation or repair |
| ❌ | Missing entirely |
| ? | Unknown — needs investigation during SV1 walkthrough |

### Matrix

| # | Step | Exists | Usable | Needs UX | Notes |
|---|------|--------|--------|----------|-------|
| 1 | Create campus | ✅ | ✅ | | `createEditorContext` + `File > New` |
| 2 | Campus metadata | ✅ | ⚠️ | ✅ | Properties panel works, no dedicated "campus" selection |
| 3 | Campus boundary | ✅ | ⚠️ | ✅ | Polygon tool exists, but campus-level boundary isn't explicit |
| 4 | Add building | ✅ | ✅ | | Draw building tool completed with tests |
| 5 | Building metadata | ✅ | ✅ | | Properties panel for buildings |
| 6 | Upload floor plan | ✅ | ⚠️ | ✅ | Asset manager exists, but UX could be smoother |
| 7 | Calibrate | ✅ | ⚠️ | ✅ | Calibration panel + tool exist, but pixel⇔world setup is manual |
| 8 | Trace hallways | ✅ | ⚠️ | ✅ | Draw hallway tool exists, vertex editing not obvious |
| 9 | Create rooms | ✅ | ⚠️ | ✅ | Draw room tool exists, naming flow could be tighter |
| 10 | Place entrances | ✅ | ⚠️ | ✅ | Place entrance tool exists, fewer clicks possible |
| 11 | Place stairs | ✅ | ✅ | | Place staircase tool, dedicated props panel |
| 12 | Place elevators | ✅ | ✅ | | Place elevator tool, dedicated props panel |
| 13 | Add QR markers | ✅ | ⚠️ | ✅ | Place QR tool exists, but QR→node binding is invisible |
| 14 | Add panoramas | ✅ | ⚠️ | ✅ | Place panorama tool exists |
| 15 | Trace roads | ✅ | ⚠️ | ✅ | Draw road tool exists |
| 16 | Run validation | ✅ | ⚠️ | ✅ | Validation engine exists, Problems panel exists — UX for navigating errors needs work |
| 17 | Fix errors | ✅ | ⚠️ | ✅ | Auto-fix registry, but finding + applying per error is clunky |
| 18 | Publish | ✅ | ⚠️ | ✅ | Publish service + workflow panel exist, feedback could be clearer |
| 19 | Inspect package | ❌ | ❌ | | No post-publish inspection UI |
| 20 | Open preview | ? | ? | | Preview capability status unknown |
| 21 | Verify navigation | ❌ | ❌ | | No preview/navigation test mode in Studio |

---

## SV1.2 — Validation Checklist

To be filled during validation session(s). Two modes:

### A. Developer Walkthrough (you, who know the system)

Focus: workflow completeness, missing features, performance.

### B. Fresh Walkthrough (someone who has never seen Studio)

Focus: discoverability, terminology, confusion points, friction.

### Template per step

```markdown
### Step N: [name]

**Expected:** [brief description]
**Actual:** [what happened]
**Clicks:** N
**Time:** Ns
**Confusion:** [none / minor / blocked]
**Errors encountered:** [description]
**Suggestions:** [optional]
```

---

## SV1.3 — UX Backlog

### Severity Levels

| Level | Definition | Action |
|-------|------------|--------|
| 🔴 Critical | Blocks completing the golden path | Fix before SV1 passes |
| 🟡 Major | Causes repeated mistakes or confusion | Fix before M8 |
| 🔵 Minor | Cosmetic or convenience gap | Schedule post-M8 |
| 🟢 Enhancement | Nice-to-have discovered during testing | Backlog |

### Format

```markdown
## [SEVERITY] Short Title

- **Step:** N
- **Observation:** what happened / what confused
- **Suggestion:** proposed improvement
- **Reported by:** [dev / fresh]
```

---

## Success Criteria

SV1 passes when:

1. ✅ The canonical scenario can be completed from empty project to published package
2. ✅ No step requires code changes, database edits, or developer intervention
3. ✅ Published package produces valid navigation (locate → search → route → arrive)
4. ✅ A new administrator can complete steps 1–18 with minimal guidance
5. ✅ All 🔴 and 🟡 issues are documented in the UX backlog
6. ✅ Every ? in the feature audit is resolved to a definite answer
