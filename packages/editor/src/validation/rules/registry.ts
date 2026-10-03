import type { ValidationRule } from './types'
import type { AnalysisPass } from './analysis'

export interface RuleProvider {
  readonly providerId: string
  registerRules(registry: RuleRegistry): void
}

export interface RuleRegistry {
  registerRule(rule: ValidationRule): void
  registerAnalysisPass<T>(pass: AnalysisPass<T>): void
  freeze(): void
}

export class DefaultRuleRegistry implements RuleRegistry {
  private _frozen = false
  private readonly _rules: ValidationRule[] = []
  private readonly _passes: AnalysisPass<unknown>[] = []

  get rules(): ReadonlyArray<ValidationRule> {
    return this._rules
  }

  get passes(): ReadonlyArray<AnalysisPass<unknown>> {
    return this._passes
  }

  get frozen(): boolean {
    return this._frozen
  }

  registerRule(rule: ValidationRule): void {
    this.assertNotFrozen()
    if (this._rules.some(r => r.ruleId === rule.ruleId)) {
      throw new Error(`Rule already registered: ${rule.ruleId}`)
    }
    this._rules.push(rule)
  }

  registerAnalysisPass<T>(pass: AnalysisPass<T>): void {
    this.assertNotFrozen()
    if (this._passes.some(p => p.produces === pass.produces)) {
      throw new Error(`Analysis pass already registered: ${pass.produces}`)
    }
    this._passes.push(pass as AnalysisPass<unknown>)
  }

  freeze(): void {
    this._frozen = true
  }

  private assertNotFrozen(): void {
    if (this._frozen) {
      throw new Error('RuleRegistry is frozen — no registration after initialize()')
    }
  }
}
