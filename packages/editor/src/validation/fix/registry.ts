import type { ValidationIssue } from '../snapshot'
import type { FixContext, FixProvider } from './types'
import type { CommandDispatcher } from '../../commands/dispatcher'
import { BaseEditorService } from '../../context'

export class AutoFixRegistry extends BaseEditorService {
  readonly id = 'autoFixRegistry'
  readonly dependencies: readonly string[] = ['dispatcher']

  private providers = new Map<string, FixProvider>()
  private dispatcher!: CommandDispatcher
  private _initialized = false

  async init(context: import('../../context').EditorServiceContext): Promise<void> {
    await super.init(context)
    this.dispatcher = context.get('dispatcher')
  }

  registerFix(provider: FixProvider): void {
    if (this._initialized) {
      throw new Error('AutoFixRegistry is initialized — no registration after initialize()')
    }
    if (this.providers.has(provider.fixId)) {
      throw new Error(`Fix provider already registered: ${provider.fixId}`)
    }
    this.providers.set(provider.fixId, provider)
  }

  getFix(fixId: string): FixProvider | undefined {
    return this.providers.get(fixId)
  }

  get registered(): readonly FixProvider[] {
    return Array.from(this.providers.values())
  }

  canFix(issue: ValidationIssue): boolean {
    if (!issue.fixId) return false
    const provider = this.providers.get(issue.fixId)
    if (!provider) return false
    const context: FixContext = { document: this.ctx.document }
    return provider.canFix(issue, context)
  }

  applyFix(issue: ValidationIssue): boolean {
    if (!issue.fixId) return false
    const provider = this.providers.get(issue.fixId)
    if (!provider) return false
    const context: FixContext = { document: this.ctx.document }
    if (!provider.canFix(issue, context)) return false
    const command = provider.createCommand(issue, context)
    if (!command) return false
    this.dispatcher.execute(command)
    return true
  }

  initialize(): void {
    this._initialized = true
  }
}
