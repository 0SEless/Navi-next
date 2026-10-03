# Security Audit — M6 Release & Evaluation (v1.0.0)

Audited: 2026-07-08
Scope: `packages/compiler`, `packages/runtime`, `scripts/`

## Threat Register

| ID | Category | Component | Status | Evidence |
|----|----------|-----------|--------|----------|
| T1 | **Tampering** | Compiler — no input validation | **OPEN** | `compile()` calls `directExtract()` on raw `CampusDocument` with zero schema validation. `JSON.parse()` in `scripts/publish.ts:37` accepts any structure. No check for required fields, type correctness, or range bounds. |
| T2 | **Information Disclosure** | Runtime — no integrity verification | **OPEN** | `ArtifactLoader.verify()` exists but is never called in `load()` or `buildSnapshot()`. Artifacts are loaded and used without checksum confirmation. A compromised artifact server could serve tampered navigation graphs. |
| T3 | **Denial of Service** | Runtime A* routing | **OPEN** | `AStar` has no node count limit, timeout, or visited-node cap. A malicious graph with 100k+ nodes or strategic edge weights could cause CPU exhaustion. Current stress test max = 5000 nodes. |
| T4 | **Spoofing** | Manifest — no signature | **OPEN** | `manifest.json` has checksums but no digital signature. Anyone who can write to the deploy directory can forge a manifest and artifacts. No key validation. |
| T5 | **Tampering** | Compiler — type assertion bypass | **OPEN** | `direct-extract.ts:34` uses `(room as any).polygon?.points` and `:51` uses `(entrance.position as any).x` — bypasses TypeScript type checking entirely. Unexpected data shapes propagate silently. |
| T6 | **Information Disclosure** | Publisher — path traversal | **MITIGATED** | `outDir` joined with `join()`. Node's `path.join` normalizes `../` sequences. Risk is limited to write-accessible directories. |
| T7 | **Denial of Service** | Compiler — unbounded graph generation | **OPEN** | `buildGraph()` iterates all extraction results with no cap on nodes (line 22-63). A campus document with 100k rooms generates 100k+ nav nodes in one loop. No pagination or batch limit. |
| T8 | **Elevation of Privilege** | Runtime loader — SSRF via fetch | **OPEN** | `ArtifactLoader` accepts `baseUrl` and fetches `${baseUrl}/${filename}`. If `baseUrl` is user-controlled (e.g., from URL param), attacker could redirect fetches to internal services. No URL allowlist. |
| T9 | **Tampering** | Compiler — no prototype pollution guard | **OPEN** | `JSON.parse()` in `publish.ts:37` accepts `__proto__` or `constructor` keys. If the campus JSON contains prototype pollution payloads, they flow into artifact generation. |
| T10 | **Tampering** | Release validation — hardcoded version | **OPEN** | `validate-release.ts:6` hardcodes `EXPECTED_COMPILER = '0.1.0'`. Any compiler version bump breaks validation. Could be bypassed by writing a version the validator expects. |

### Summary

| Metric | Count |
|--------|-------|
| Threats found | 10 |
| Closed | 1 (T6 — mitigated) |
| Open | 9 |

## Accepted Risks

| ID | Risk | Rationale |
|----|------|-----------|
| T4 | No manifest signature | Offline/trusted-network deployment model. Signature infrastructure (key generation, distribution, rotation) is not justified for v1.0. Add when cloud publishing is required. |

## Audit Trail

### 2026-07-08: Initial Security Audit
- **Method**: Manual code review of 8 source files (`publisher/index.ts`, `compile.ts`, `direct-extract.ts`, `artifact-loader.ts`, `artifact-generator.ts`, `routing-engine.ts`, `publish.ts`, `validate-release.ts`)
- **Triage**: STRIDE classification across 10 threat categories
- **Findings**: 9 open, 1 mitigated, 1 accepted
- **Action required**: T1, T2, T3, T5, T7, T8, T9, T10 need disposition before next milestone

## Remediation Guidance

| Priority | ID | Fix |
|----------|----|-----|
| P0 | T1 | Add `validateCampusDocument()` that checks required fields, type correctness, range bounds before compilation |
| P0 | T9 | Use `JSON.parse()` with a reviver that rejects `__proto__` or use a schema validator (Zod, io-ts) |
| P0 | T2 | Wire `ArtifactLoader.verify()` into `buildSnapshot()` — reject on checksum mismatch |
| P1 | T3 | Add `maxNodes`, `timeoutMs` config to AStar constructor; cap at 50k nodes / 5s |
| P1 | T8 | Add `allowedOrigins` option to `LoaderOptions`; validate baseUrl against allowlist |
| P1 | T5 | Replace `(room as any)` with proper discriminated unions or Zod-validated types |
| P2 | T7 | Add `maxRooms` / `maxNodes` config to `CompilerConfig` with a hard upper limit |
| P2 | T10 | Read expected version from `package.json` instead of hardcoding |
