import type { ParametricComponent, ParametricDefinition, PrimitiveGeometry } from '@/types/parametric-types'
import type { Diagnostic } from '@/diagnostics/diagnostic-types'
import { evaluateConstraints } from '@/diagnostics/parameter/evaluate-constraints'

export class ParametricEngine {
  private components: Map<string, ParametricComponent> = new Map()
  private definitions: Map<string, ParametricDefinition> = new Map()
  private counter = 0

  register(def: ParametricDefinition): void {
    this.definitions.set(def.id, def)
  }

  create(definition: ParametricDefinition, params: Record<string, unknown> = {}): ParametricComponent {
    const base = definition.create(params)
    const id = `parametric-${++this.counter}`
    const component: ParametricComponent = { ...base, id }
    this.components.set(id, component)
    return component
  }

  add(component: ParametricComponent): void {
    this.components.set(component.id, component)
  }

  remove(id: string): boolean {
    return this.components.delete(id)
  }

  get(id: string): ParametricComponent | undefined {
    return this.components.get(id)
  }

  getAll(): ParametricComponent[] {
    return Array.from(this.components.values())
  }

  getDefinition(id: string): ParametricDefinition | undefined {
    return this.definitions.get(id)
  }

  getGeometry(component: ParametricComponent): PrimitiveGeometry[] {
    const def = this.definitions.get(component.definitionId)
    if (!def) return []
    return def.geometry(component)
  }

  updateProperty(id: string, key: string, value: unknown): ParametricComponent | undefined {
    const c = this.components.get(id)
    if (!c) return undefined
    c.properties = { ...c.properties, [key]: value }
    return c
  }

  validate(component: ParametricComponent): Diagnostic[] {
    const def = this.definitions.get(component.definitionId)
    return evaluateConstraints(component, def as any)
  }
}
