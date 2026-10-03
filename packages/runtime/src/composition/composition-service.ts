import type { RuntimeEngine } from '../engine'

/**
 * Marker interface for runtime composition services.
 *
 * Composition services:
 * - are constructed from RuntimeEngine
 * - orchestrate capabilities (never access LoadedPackage or artifacts)
 * - never execute UI actions (viewer, map, geolocation)
 * - emit workflow models only
 *
 * Per M7.0 SPEC §1: a composition service satisfies all of:
 *   - constructed from RuntimeEngine only
 *   - public methods return journey/workflow results, not raw DTOs
 *   - every data question delegated to a capability
 *   - named for the user journey, not for a data domain
 */
export interface CompositionService {
  // marker — no shared lifecycle or methods yet
}

/**
 * Base shape for composition service constructors.
 * Concrete services accept RuntimeEngine (never LoadedPackage).
 */
export type CompositionConstructor<T extends CompositionService> =
  new (engine: RuntimeEngine) => T
