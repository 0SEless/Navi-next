import type { LatLng } from '@navi/core'
import type { RuntimeEngine } from '../engine'
import type { LocationContext } from '../engine/location-service'
import type { SearchResult } from '../engine/search-service'
import type { PanoramaResult } from '../engine/panorama-service'
import type { CompositionService } from './composition-service'

// ── Reference Composition Service (M7.0 template) ──
//
// This file is INTENTIONALLY GENERIC and INSTRUCTIONAL.
// It exists to PROVE THE ARCHITECTURE, not to solve a campus problem.
// Future developers must never mistake it for production code.
//
// It demonstrates:
//   - Construction from RuntimeEngine only
//   - Delegation to capabilities (never LoadedPackage or artifacts)
//   - A workflow-shaped return type (not raw DTOs)
//   - Journey-scoped state (current step index)
//   - Synchronous, platform-independent methods
//   - No viewer/map/geolocation/UI APIs
//
// M7.1+ services copy this shape but use real domain names.

export interface SuggestedJourney {
  readonly position: LatLng
  readonly location: LocationContext
  readonly suggestion?: SearchResult
  readonly arrivalPanorama?: PanoramaResult
}

export interface JourneyStep {
  readonly index: number
  readonly label: string
}

export class ReferenceCompositionService implements CompositionService {
  private currentStep = 0
  private readonly steps: JourneyStep[]

  constructor(
    private readonly engine: RuntimeEngine,
  ) {
    this.steps = [
      { index: 0, label: 'Resolve position' },
      { index: 1, label: 'Find nearby destination' },
      { index: 2, label: 'Look up arrival panorama' },
    ]
  }

  /**
   * Demonstrate composing three capabilities into a single workflow result.
   * Pure orchestration — no data the capabilities don't already supply.
   */
  suggestStartingPoint(position: LatLng): SuggestedJourney {
    const location = this.engine.location.resolve(position)
    const label = location.node?.node.label ?? 'entrance'
    const results = this.engine.search.search(label)
    const suggestion = results.length > 0 ? results[0] : undefined
    const arrivalPanorama = suggestion?.nodeId
      ? this.engine.panoramas.resolve(suggestion.nodeId)
      : this.engine.panoramas.findNearest(position)

    return {
      position,
      location,
      suggestion,
      arrivalPanorama,
    }
  }

  /**
   * Journey-step navigation — synchronous, app drives pacing.
   */
  current(): JourneyStep {
    return this.steps[this.currentStep] ?? this.steps[this.steps.length - 1]
  }

  next(): JourneyStep {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++
    }
    return this.steps[this.currentStep]
  }

  reset(): void {
    this.currentStep = 0
  }
}
