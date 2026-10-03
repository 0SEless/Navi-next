import type { Tool, ToolPointerEvent, ToolContext } from './types'
import type { EntitySelector } from '../context/entity-id'
import { SelectionOrigin } from '../context/entity-id'

export interface SelectToolState {
  selectTarget: EntitySelector | null
}

export class SelectTool implements Tool {
  readonly id = 'select'
  readonly label = 'Select'
  readonly cursor = 'default'

  private _selectTarget: EntitySelector | null = null

  get state(): SelectToolState {
    return {
      selectTarget: this._selectTarget ? { ...this._selectTarget } as EntitySelector : null,
    }
  }

  onActivate(_ctx: ToolContext): void {
    this.reset()
  }

  onDeactivate(_ctx: ToolContext): void {
    this.reset()
  }

  onPointerDown(event: ToolPointerEvent, ctx: ToolContext): void {
    ctx.services.selection.clear(SelectionOrigin.Canvas)
  }

  onPointerMove(event: ToolPointerEvent, ctx: ToolContext): void {
    // hover is handled by the canvas hit-test layer externally
  }

  onPointerUp(event: ToolPointerEvent, _ctx: ToolContext): void {
    // selection is driven by the canvas hit-test layer calling selection.select()
  }

  onKeyDown(event: KeyboardEvent, ctx: ToolContext): void {
    if (event.key === 'Escape') {
      ctx.services.selection.clear(SelectionOrigin.Keyboard)
    }
  }

  selectEntity(selector: EntitySelector, ctx: ToolContext): void {
    this._selectTarget = selector
    ctx.services.selection.select(selector, SelectionOrigin.Canvas)
  }

  private reset(): void {
    this._selectTarget = null
  }
}
