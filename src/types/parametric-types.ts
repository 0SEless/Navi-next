/**
 * FROZEN API — RC-1 MILESTONE (re-export shim)
 *
 * canonical location: @navi/editor (packages/editor/src/types/parametric-types.ts);
 * re-exported here for the frozen RC-1 import path.
 *
 * All existing import paths and export names keep working — this module was
 * relocated to @navi/editor in T0.4 so packages/editor can consume it without
 * violating the dependency direction (packages/editor must not import from
 * navi-next/src). Signature changes require a new major version and an ADR.
 */
export * from '@navi/editor/src/types/parametric-types'