import type { LatLng, RoutePreferences } from '@navi/core'
import type { Route } from '../routing'
import type {
  LocationContext,
  SearchResult,
  BuildingResult,
  EntranceResult,
  PanoramaResult,
} from '../engine'

// ── Status ──

export type JourneyStatus =
  | 'not-started'
  | 'in-progress'
  | 'waiting-on-user'
  | 'complete'
  | 'failed'

// ── Step variants ──

export interface JourneyStepBase {
  readonly id: string
  readonly kind: string
}

// Automatic steps

export interface LocateStep extends JourneyStepBase {
  readonly kind: 'locate'
  readonly location: LocationContext
}

export interface SearchStep extends JourneyStepBase {
  readonly kind: 'search'
  readonly results: SearchResult[]
}

export interface NavigateStep extends JourneyStepBase {
  readonly kind: 'navigate'
  readonly route: Route
  readonly destination: BuildingResult
  readonly entrance: EntranceResult
}

export interface ArrivalStep extends JourneyStepBase {
  readonly kind: 'arrive'
  readonly building: BuildingResult
  readonly floor: number
}

export interface PanoramaStep extends JourneyStepBase {
  readonly kind: 'panorama'
  readonly panorama: PanoramaResult
}

// Interactive steps

export interface SelectDestinationStep extends JourneyStepBase {
  readonly kind: 'select-destination'
  readonly query: string
  readonly candidates: SearchResult[]
}

export interface SelectEntranceStep extends JourneyStepBase {
  readonly kind: 'select-entrance'
  readonly building: BuildingResult
  readonly entrances: EntranceResult[]
}

export interface ConfirmOption {
  readonly id: string
  readonly label: string
}

export interface ConfirmStep extends JourneyStepBase {
  readonly kind: 'confirm'
  readonly prompt: string
  readonly options: ConfirmOption[]
}

// Discriminated union

export type JourneyStep =
  | LocateStep
  | SearchStep
  | NavigateStep
  | ArrivalStep
  | PanoramaStep
  | SelectDestinationStep
  | SelectEntranceStep
  | ConfirmStep

// ── Execution context (service continuation data) ──

export interface JourneyContext {
  /** ID of the destination the user (or single-result search) selected. */
  resolvedDestinationId?: string
  /** Node ID of the resolved destination (for routing). Set when destination is known
      but no NavigateStep exists yet. */
  resolvedNodeId?: string
  /** Building ID of the resolved destination (for building lookup). */
  resolvedBuildingId?: string

  // Multi-stop sequencing — completed → current → remaining
  completedStops?: string[]
  currentStop?: string
  remainingStops?: string[]
}

// ── Journey request ──

export interface JourneyRequest {
  origin: LatLng
  /** Ordered list of destinations (single or multiple stops). */
  stops: readonly string[]
  routing?: RoutePreferences
}

// ── Journey ──

export class Journey {
  readonly id: string
  readonly request: JourneyRequest
  readonly context: JourneyContext
  private _steps: readonly JourneyStep[]
  private _index: number
  private _status: JourneyStatus

  constructor(id: string, request: JourneyRequest, steps: JourneyStep[], context?: JourneyContext) {
    this.id = id
    this.request = request
    this.context = context ?? {}
    this._steps = steps
    this._index = 0
    this._status = 'not-started'
  }

  /** Convenience accessor for the origin position. */
  get position(): LatLng {
    return this.request.origin
  }

  get steps(): readonly JourneyStep[] {
    return this._steps
  }

  get currentIndex(): number {
    return this._index
  }

  get currentStepId(): string {
    return this.current().id
  }

  get status(): JourneyStatus {
    return this._status
  }

  current(): JourneyStep {
    return this._steps[this._index] ?? this._steps[this._steps.length - 1]
  }

  next(): JourneyStep {
    if (this._status === 'waiting-on-user') {
      throw new Error('Cannot advance while waiting for user input')
    }
    if (this._status === 'complete') {
      return this.current()
    }
    if (this._status === 'not-started') {
      this._status = 'in-progress'
    }
    if (this._index < this._steps.length - 1) {
      this._index++
    }
    const step = this.current()
    if (this._isInteractionStep(step)) {
      this._status = 'waiting-on-user'
    }
    return step
  }

  previous(): JourneyStep {
    if (this._index > 0) {
      this._index--
      if (this._status === 'complete') {
        this._status = 'in-progress'
      }
    }
    return this.current()
  }

  respond(response: unknown): void {
    if (this._status !== 'waiting-on-user') {
      throw new Error('Cannot respond when journey is not waiting for user input')
    }
    const step = this.current()
    if (step.kind === 'select-destination' || step.kind === 'select-entrance') {
      if (typeof response !== 'string' || response.length === 0) {
        throw new Error(`Expected a non-empty string response for step kind "${step.kind}"`)
      }
    } else if (step.kind === 'confirm') {
      if (typeof response !== 'boolean') {
        throw new Error('Expected a boolean response for confirm step')
      }
    }
    // Store response in context for service to read during advance()
    if (step.kind === 'select-destination' || step.kind === 'select-entrance') {
      this.context.resolvedDestinationId = response as string
    }
    this._status = 'in-progress'
  }

  reset(): void {
    this._index = 0
    this._status = 'not-started'
  }

  isComplete(): boolean {
    return this._status === 'complete'
  }

  /** Append a new step — used by composition services to extend the journey. */
  appendStep(step: JourneyStep): void {
    const mutable = this._steps as JourneyStep[]
    mutable.push(step)
  }

  /** Called by composition services to mark the workflow as complete. */
  markComplete(): void {
    this._status = 'complete'
  }

  /** Called by composition services to mark the workflow as failed. */
  markFailed(reason?: string): void {
    this._status = 'failed'
  }

  private _isInteractionStep(step: JourneyStep): boolean {
    return step.kind === 'select-destination'
      || step.kind === 'select-entrance'
      || step.kind === 'confirm'
  }
}
