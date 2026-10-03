import type { ParametricComponent } from '@/types/parametric-types'

export function applyTranslation(component: ParametricComponent, delta: { x: number; y: number }): ParametricComponent {
  return { ...component, position: { x: component.position.x + delta.x, y: component.position.y + delta.y } }
}

export function applyRotation(component: ParametricComponent, angleDeg: number): ParametricComponent {
  return { ...component, rotation: angleDeg }
}

export function setPosition(component: ParametricComponent, position: { x: number; y: number }): ParametricComponent {
  return { ...component, position: { ...position } }
}
