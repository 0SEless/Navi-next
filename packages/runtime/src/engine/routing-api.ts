import { RoutingEngine } from '../routing/routing-engine'
import type { Route } from '../routing/route'

export class RoutingAPI {
  private engine: RoutingEngine | null = null

  setEngine(engine: RoutingEngine): void {
    this.engine = engine
  }

  findRoute(fromId: string, toId: string): Route | null {
    if (!this.engine) throw new Error('RoutingEngine not initialized')
    return this.engine.findRoute(fromId, toId)
  }
}
