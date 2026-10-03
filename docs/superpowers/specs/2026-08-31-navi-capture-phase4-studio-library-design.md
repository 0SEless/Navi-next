# NAVI Capture — Phase 4 Studio Capture Library

## Goal

Add a read-oriented, campus-scoped Studio surface for authenticated users to find synced NAVI Capture sessions and open one in the existing Studio Capture Reviewer.

The feature connects the already-proven local Capture/sync flow to the already-proven Reviewer/import flow without changing the Capture recorder, the canonical document model, or the compiler/publish/runtime surfaces.

## Scope

### In scope

- A campus-scoped route at `/studio/[campusId]/edit/capture-library`.
- Listing the authenticated owner's remote Capture session summaries filtered by the route campus ID.
- Read-only provider-neutral access to remote Capture summaries and full sessions.
- Library metadata: title, Capture status, remote/synced state, campus, timestamps, raw sample count when available, candidate count when available, and marker count when available.
- Clear empty, loading, authentication, unavailable, deleted, malformed, and temporary-error states.
- Opening a selected remote session in the existing Studio Reviewer through `?sessionId=<id>`.
- Defense-in-depth campus validation in both the Library open flow and Reviewer hydration flow.
- A clear return path from the Reviewer to the same campus-scoped Library.
- An `Imported here` indicator only when the existing versioned `CaptureImportManifest` has reliable provenance for that session in the current browser.
- Automated tests and manual responsive QA for the new read-only surface.

### Out of scope

- Capture recording, GPS collection, IndexedDB payload changes, or sync retry behavior.
- New Supabase tables, migrations, RPCs, Storage objects, or RLS changes.
- Global cross-campus Capture browsing.
- A second Reviewer implementation.
- Direct document/store mutation from the Library.
- New import, Road editing, compiler, publish, runtime, indoor-routing, marker-import, service-worker, or NAVI Web behavior.
- Remote deletion.
- Studio-wide history/lifecycle changes.

## User flow

```text
Studio campus card
  → campus-scoped Capture Library
  → authenticated owner's synced sessions for that campus
  → select a session
  → full-session fetch and campus validation
  → existing Studio Capture Reviewer?sessionId=<id>
  → existing Phase 2C Preview/Import flow
  → Back to Capture Library returns to the same campus route
```

The Library never falls back to IndexedDB or local-file sessions. A remote read failure remains a visible error. Opening a session is read-only until the existing explicit `Import selected` action is used in the Reviewer.

## Architecture

### Provider-neutral boundary

The existing `CaptureCloudRepository` remains the source of remote reads:

- `listSessions({ campusId })` returns summaries.
- `getSession(sessionId)` returns the validated full Capture session.

The existing Capture sync context may expose these operations as read-only context methods so UI code does not import Supabase or know the `capture_sessions` table. The Supabase provider remains the adapter that supplies the repository and the existing owner-authenticated RLS behavior.

No browser code may use service-role credentials. The repository must continue to authenticate before reading, and the database owner policy remains the authority for row access.

### Campus guard

The route's `[campusId]` is the authoritative campus context. The Library requests summaries with that exact ID. Before navigation and again during Reviewer hydration, the following must all agree:

- route campus ID;
- remote summary campus ID when available;
- remote full-session `campusId`.

Missing or mismatched campus data fails closed with a clear message and performs no Studio mutation.

### Reviewer integration

The existing `CaptureReviewer` remains the only review surface. It gains an optional remote-session loading mode identified by `sessionId` while retaining its current local-session and local-file behavior when no remote ID is supplied.

Remote mode must:

- clear the current review item before loading a new requested ID;
- discard stale results when the requested ID changes or the component unmounts;
- show only the requested validated remote session;
- never silently substitute a local session;
- preserve raw samples, candidate geometry, markers, and the existing review selection state keyed by session ID.

The Studio wrapper supplies the existing import host and the read-only remote loader. No new import adapter or editor command is introduced.

## Library screen

The Library should use the existing NAVI design system and remain usable at desktop and narrow Studio widths.

Required states:

1. Loading remote sessions.
2. Authenticated list with session cards/rows.
3. Empty campus result with recovery guidance.
4. Authentication/unavailable state with sign-in or retry guidance; no local fallback.
5. Temporary list failure with retry.
6. Open failure for deleted, malformed, unauthorized, or campus-mismatched sessions.

Each row may show:

- title;
- `Synced` remote state and the Capture status;
- campus association;
- captured/updated timestamps;
- raw sample count, candidate point/segment count, and marker count when present in the remote summary;
- `Imported here` only when the existing manifest proves at least one matching imported segment for the same session and campus.

The list must not claim that a session is globally unimported when the local manifest is unavailable or does not represent another Studio device.

## Security and data safety

- Existing admin middleware protection remains sufficient; no new auth bypass is added.
- Remote reads use the authenticated browser Supabase client and existing owner RLS.
- No anonymous access or service-role key is introduced.
- The Library does not call editor stores, graph APIs, compiler APIs, publish APIs, or runtime APIs.
- Library mount, refresh, row selection, and Reviewer hydration do not mutate `CampusDocument`, create Roads, compile, publish, or modify published data.
- Existing import remains the sole explicit mutation path.

## Navigation

Add a discoverable campus-card action for Capture Library. The existing Studio Reviewer gets a return action that preserves the current campus ID and returns to `/studio/<campusId>/edit/capture-library`.

The existing general `/studio/capture-review` route remains compatible for local/file review. The campus-scoped route is the Phase 4 entry point for synced sessions.

## Error handling

Provider-neutral errors must be mapped to clear user-facing messages without exposing Supabase-specific implementation details. At minimum:

- no authenticated remote access → request sign-in or show unavailable;
- network/temporary failure → retry;
- missing remote row → explain that the session is no longer available;
- invalid remote row/payload → explain that the session cannot be reviewed;
- campus mismatch → explain that the session cannot be opened in this campus.

Every failure is read-only and leaves the Studio document unchanged.

## Acceptance criteria

1. An authenticated user can open `/studio/[campusId]/edit/capture-library` and see only owner-owned remote sessions for that campus.
2. The Library remains read-only and has no references to forbidden production/runtime stores or APIs.
3. Opening a row fetches and validates the full remote session, then hydrates the existing Reviewer through `?sessionId=...`.
4. Switching requested sessions or returning from the Reviewer cannot display a stale previous remote session or a local fallback.
5. Campus mismatch, unauthorized, missing, malformed, and temporary-failure cases fail closed with clear UI.
6. The existing manifest may produce `Imported here`; absent/unreliable provenance produces no imported claim.
7. Existing Phase 1, Phase 2A, Phase 2C/2C-S, Phase 3, Studio/editor, compiler/navigation, runtime/public compatibility, and route tests remain at their locked baselines.
8. No Supabase migration or schema change is introduced.

## Known pitfalls carried forward

- Use quoted literal paths for `(admin)` and `[id]` route files in PowerShell probes and test commands.
- Do not attribute broad full-suite failures to Capture without comparing the locked focused suites; the dirty checkout has known parallel/stateful failures.
- Do not use Graphify refresh failure as evidence of an application regression; the managed checkout has a repeated `[WinError 5] Access is denied` limitation.
- Keep browser QA claims tied to the final URL and actual controlled tab; mock auth does not prove real Supabase owner access.
- Avoid timer-dependent initial remote loads; previous Reviewer timing behavior caused broad-suite isolation failures.
- Do not change editor lifecycle/history architecture to preserve navigation state; the Phase 2C-S lifecycle limitation is documented and out of scope.
