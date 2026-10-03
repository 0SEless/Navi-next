export interface ToolPointerEvent {
  x: number
  y: number
  lng: number
  lat: number
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

import type { ServiceAccessor } from '../context'
import type { CampusDocument } from '@navi/core'

export interface ToolContext {
  /** Typed access to editor services. */
  services: ServiceAccessor
  /** The current campus document (for resolving entity IDs to levels, etc.). */
  document?: CampusDocument
}

export interface Tool {
  id: string
  label: string
  cursor?: string

  onActivate?(ctx: ToolContext): void
  onDeactivate?(ctx: ToolContext): void
  onPointerDown?(event: ToolPointerEvent, ctx: ToolContext): void
  onPointerMove?(event: ToolPointerEvent, ctx: ToolContext): void
  onPointerUp?(event: ToolPointerEvent, ctx: ToolContext): void
  onKeyDown?(event: KeyboardEvent, ctx: ToolContext): void
}
