import type { LatLng } from '@navi/core'
import type { RuntimeEngine } from '../engine'
import type { SearchResult } from '../engine'
import { Journey } from './journey-model'
import type { JourneyRequest } from './journey-model'
import type {
  LocateStep,
  NavigateStep,
  ArrivalStep,
  PanoramaStep,
  SelectDestinationStep,
} from './journey-model'
import type { CompositionService } from './composition-service'

export class VisitorJourneyService implements CompositionService {
  constructor(private readonly engine: RuntimeEngine) {}

  /** @deprecated Use begin(JourneyRequest) instead. */
  begin(position: LatLng, destination: string): Journey
  begin(request: JourneyRequest): Journey
  begin(positionOrRequest: LatLng | JourneyRequest, destination?: string): Journey {
    const request: JourneyRequest = typeof positionOrRequest === 'object' && 'origin' in positionOrRequest
      ? positionOrRequest
      : { origin: positionOrRequest as LatLng, stops: [destination!] }

    const location = this.engine.location.resolve(request.origin)
    const locateStep: LocateStep = {
      id: crypto.randomUUID(),
      kind: 'locate',
      location,
    }

    const firstStop = request.stops[0]
    if (!firstStop) {
      const j = new Journey(crypto.randomUUID(), request, [locateStep])
      j.markFailed('No stops provided')
      return j
    }

    const j = new Journey(crypto.randomUUID(), request, [locateStep], {
      currentStop: firstStop,
      remainingStops: request.stops.slice(1),
    })
    this._setContextFromSearch(j, firstStop)
    return j
  }

  advance(journey: Journey): Journey {
    if (journey.isComplete() || journey.status === 'failed') {
      return journey
    }

    const step = journey.current()
    if (step.kind === 'locate') {
      return this._advanceFromLocate(journey, step)
    }
    if (step.kind === 'select-destination') {
      return this._advanceFromSelect(journey, step)
    }
    if (step.kind === 'navigate') {
      return this._advanceFromNavigate(journey, step)
    }
    if (step.kind === 'arrive') {
      return this._advanceFromArrive(journey, step)
    }
    if (step.kind === 'panorama') {
      journey.markComplete()
      return journey
    }
    return journey
  }

  /** Search for a stop name and set context fields (or append SelectDestinationStep if ambiguous). */
  private _setContextFromSearch(journey: Journey, stopName: string): void {
    const results = this.engine.search.search(stopName)

    if (results.length === 0) {
      journey.markFailed(`No results found for "${stopName}"`)
      return
    }

    if (results.length === 1) {
      journey.context.resolvedDestinationId = results[0].id
      journey.context.resolvedNodeId = results[0].nodeId
      journey.context.resolvedBuildingId = results[0].buildingId
      return
    }

    const selectStep: SelectDestinationStep = {
      id: crypto.randomUUID(),
      kind: 'select-destination',
      query: stopName,
      candidates: results,
    }
    journey.appendStep(selectStep)
  }

  /** Advance from locate — single-result path builds NavigateStep. */
  private _advanceFromLocate(journey: Journey, step: LocateStep): Journey {
    const destinationId = journey.context.resolvedDestinationId
    if (!destinationId) {
      // Multi-result: SelectDestinationStep already appended by _setContextFromSearch
      return journey
    }

    // Single-result path: build NavigateStep from context
    const fromNodeId = step.location.node?.node.id
    if (!fromNodeId) {
      journey.markFailed('Could not determine current location node')
      return journey
    }

    const nodeId = journey.context.resolvedNodeId
    if (!nodeId) {
      journey.markFailed('Could not find destination details')
      return journey
    }

    return this._buildNavigateStepFromIds(
      journey,
      fromNodeId,
      destinationId,
      nodeId,
      journey.context.resolvedBuildingId ?? 'unknown',
    )
  }

  /** After user responds to SelectDestinationStep, build the NavigateStep. */
  private _advanceFromSelect(journey: Journey, step: SelectDestinationStep): Journey {
    const destinationId = journey.context.resolvedDestinationId
    if (!destinationId) {
      return journey
    }

    const fromNodeId = this._findFromNodeInJourney(journey)
    if (!fromNodeId) {
      journey.markFailed('Could not determine current location node')
      return journey
    }

    const candidate = step.candidates.find(c => c.id === destinationId)
    if (!candidate) {
      journey.markFailed('Selected destination not found among candidates')
      return journey
    }

    return this._buildNavigateStep(journey, fromNodeId, candidate)
  }

  private _advanceFromNavigate(journey: Journey, step: NavigateStep): Journey {
    const arrivalStep: ArrivalStep = {
      id: crypto.randomUUID(),
      kind: 'arrive',
      building: step.destination,
      floor: step.entrance ? 0 : 0,
    }
    journey.appendStep(arrivalStep)
    return journey
  }

  private _advanceFromArrive(journey: Journey, step: ArrivalStep): Journey {
    const remaining = journey.context.remainingStops
    if (remaining && remaining.length > 0) {
      // Record completed stop
      const completed = journey.context.completedStops ?? []
      completed.push(journey.context.currentStop ?? '')
      journey.context.completedStops = completed

      // Clear previous stop's context before searching for next
      delete journey.context.resolvedDestinationId
      delete journey.context.resolvedNodeId
      delete journey.context.resolvedBuildingId

      // Advance to next stop
      const nextStop = remaining.shift()!
      journey.context.currentStop = nextStop
      this._setContextFromSearch(journey, nextStop)

      // Single result found — build NavigateStep directly
      if (journey.context.resolvedNodeId && journey.status !== 'failed') {
        const fromNodeId = this._findFromNodeInJourney(journey)
        if (fromNodeId) {
          this._buildNavigateStepFromIds(
            journey,
            fromNodeId,
            journey.context.resolvedDestinationId!,
            journey.context.resolvedNodeId,
            journey.context.resolvedBuildingId ?? 'unknown',
          )
        }
      }
      // Multi-result: SelectDestinationStep already appended by _setContextFromSearch

      return journey
    }

    // Final stop — panorama or complete
    const panorama = this.engine.panoramas.resolve(step.building.id)
      ?? this.engine.panoramas.findNearest(journey.position)

    if (panorama) {
      const panoStep: PanoramaStep = {
        id: crypto.randomUUID(),
        kind: 'panorama',
        panorama,
      }
      journey.appendStep(panoStep)
    } else {
      journey.markComplete()
    }
    return journey
  }

  private _buildNavigateStepFromIds(
    journey: Journey,
    fromNodeId: string,
    destinationId: string,
    nodeId: string,
    buildingId: string,
  ): Journey {
    const building = buildingId && buildingId !== 'unknown'
      ? this.engine.buildings.get(buildingId)
      : undefined

    const route = this.engine.navigation.findRoute(fromNodeId, nodeId, journey.request.routing)

    if (!route) {
      journey.markFailed('Could not find route to destination')
      return journey
    }

    const entrances = building
      ? this.engine.buildings.getEntrances(building.id)
      : []

    const navigateStep: NavigateStep = {
      id: crypto.randomUUID(),
      kind: 'navigate',
      route,
      destination: building ?? {
        id: buildingId,
        name: `Destination ${destinationId}`,
        code: '',
        category: '',
        position: journey.position,
        entrances: [],
        floors: [],
      },
      entrance: entrances.length > 0 ? entrances[0] : {
        id: 'default',
        name: `Destination ${destinationId}`,
        position: journey.position,
      },
    }
    journey.appendStep(navigateStep)
    return journey
  }

  private _buildNavigateStep(
    journey: Journey,
    fromNodeId: string,
    candidate: SearchResult,
  ): Journey {
    const building = candidate.buildingId
      ? this.engine.buildings.get(candidate.buildingId)
      : undefined

    const route = this.engine.navigation.findRoute(fromNodeId, candidate.nodeId, journey.request.routing)

    if (!route) {
      journey.markFailed('Could not find route to destination')
      return journey
    }

    const entrances = building
      ? this.engine.buildings.getEntrances(building.id)
      : []

    const navigateStep: NavigateStep = {
      id: crypto.randomUUID(),
      kind: 'navigate',
      route,
      destination: building ?? {
        id: candidate.buildingId ?? 'unknown',
        name: candidate.title,
        code: '',
        category: '',
        position: journey.position,
        entrances: [],
        floors: [],
      },
      entrance: entrances.length > 0 ? entrances[0] : {
        id: 'default',
        name: candidate.title,
        position: journey.position,
      },
    }
    journey.appendStep(navigateStep)
    return journey
  }

  /** Walk back through completed steps to find the snapped node ID. */
  private _findFromNodeInJourney(journey: Journey): string | undefined {
    for (const s of journey.steps) {
      if (s.kind === 'locate') {
        return s.location.node?.node.id
      }
    }
    return undefined
  }
}
