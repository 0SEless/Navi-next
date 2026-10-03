import type { CampusDocument } from '@navi/core'
import type { Extractor, ExtractionContext } from './types'
import type { ExtractionResult, NavigationSpace, TransitionPoint, WalkableCorridor } from '../types'

export class ExtractionCoordinator {
  private extractors: Extractor<any, any>[] = []

  register<TInput, TOutput>(extractor: Extractor<TInput, TOutput>): void {
    this.extractors.push(extractor)
  }

  extractAll(document: CampusDocument, context: ExtractionContext): ExtractionResult {
    const start = performance.now()

    const spaces: NavigationSpace[] = []
    const transitions: TransitionPoint[] = []
    const corridors: WalkableCorridor[] = []
    const seenIds = new Set<string>()

    for (const extractor of this.extractors) {
      const items = extractor.extract(document, context) as any[]
      for (const item of items) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id)
          if ('polyline' in item) {
            corridors.push(item)
          } else if ('connectsTo' in item || 'type' in item && ['entrance', 'staircase', 'elevator', 'qr_checkpoint', 'panorama'].includes(item.type)) {
            transitions.push(item)
          } else {
            spaces.push(item)
          }
        }
      }
    }

    return { spaces, transitions, corridors, duration: performance.now() - start }
  }
}
