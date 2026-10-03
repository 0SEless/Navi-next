# NAVI — Navigation Application for Visually Impaired

Multi-campus indoor/outdoor navigation platform. Monorepo with four packages and a Next.js application.

## Packages

| Package | Role | Status |
|---------|------|--------|
| `@navi/core` | Shared types, geometry, coordinates | ✅ Stable |
| `@navi/compiler` | Campus document → navigation graph (plugin pipeline) | ✅ Stable |
| `@navi/editor` | Studio editing tools, validation, services | 🟡 Active |
| `@navi/runtime` | Loader, routing engine (A*), search, positioning | ✅ Stable (M5) |

## Pipeline

```
CampusDocument → Compiler → Publisher → Package → Loader → RuntimeEngine
```

See `docs/architecture/pipeline-overview.md` for the canonical architecture diagram.

## Milestones

| Milestone | Tag | Status |
|-----------|-----|--------|
| M1–M4 | — | ✅ Complete |
| M5 Runtime Pipeline | `v0.13-runtime-pipeline-complete` | ✅ Complete |
| M6 Runtime Services | — | 🟡 In progress |
| M7 User Application | — | ⏳ Planned |
| M8 Studio UX | — | ⏳ Planned |

## Getting Started

```bash
npm install
npm run dev        # Next.js studio app
npx vitest run     # all tests
```

Tests: 103+ tests across 12 files in `@navi/runtime` alone. Full suite runs from root.
