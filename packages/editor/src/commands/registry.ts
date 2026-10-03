import type { CommandHandler } from './types'

export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>()

  register(handler: CommandHandler): void {
    if (this.handlers.has(handler.id)) {
      throw new Error(`Command handler already registered: ${handler.id}`)
    }
    this.handlers.set(handler.id, handler)
  }

  get(id: string): CommandHandler | undefined {
    return this.handlers.get(id)
  }

  has(id: string): boolean {
    return this.handlers.has(id)
  }

  remove(id: string): void {
    this.handlers.delete(id)
  }

  get all(): CommandHandler[] {
    return Array.from(this.handlers.values())
  }

  get size(): number {
    return this.handlers.size
  }
}
