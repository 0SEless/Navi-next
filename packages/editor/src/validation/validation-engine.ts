import { getChangesSince, type EntityChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import { BaseEditorService } from '../context'
import type { ValidationSnapshot } from './snapshot'
import { buildSnapshot } from './snapshot'
import type { ValidationRule, ValidationContext, ProfileConfig, ValidationProfileId, ValidationAffinity } from './rules/types'
import type { AnalysisPass } from './rules/analysis'
import { buildAnalysisCache } from './rules/analysis'
import type { RuleProvider } from './rules/registry'
import { DefaultRuleRegistry } from './rules/registry'
import { getProfile, getDefaultProfile, resolveConfig } from './profiles'

export class ValidationEngine extends BaseEditorService {
  readonly id = 'validationEngine'
  readonly dependencies: readonly string[] = []

  private registry = new DefaultRuleRegistry()
  private _initialized = false
  private _snapshot: ValidationSnapshot | undefined
  private _epoch = 0
  private _listeners = new Set<(snapshot: ValidationSnapshot) => void>()
  private _dirty = false

  markDirty(): void {
    this._dirty = true
  }

  registerRuleProvider(provider: RuleProvider): void {
    if (this._initialized) {
      throw new Error('ValidationEngine is initialized — no registration after initialize()')
    }
    provider.registerRules(this.registry)
  }

  registerRule(rule: ValidationRule): void {
    if (this._initialized) throw new Error('ValidationEngine is initialized')
    this.registry.registerRule(rule)
  }

  registerAnalysisPass<T>(pass: AnalysisPass<T>): void {
    if (this._initialized) throw new Error('ValidationEngine is initialized')
    this.registry.registerAnalysisPass(pass)
  }

  initialize(): void {
    this.registry.freeze()
    this._initialized = true
  }

  validate(document: CampusDocument, profile?: string): ValidationSnapshot {
    const resolvedProfile = (profile ?? getDefaultProfile()) as ValidationProfileId
    const currentVersion = document.version

    if (this._snapshot
        && this._snapshot.documentVersion === currentVersion
        && this._snapshot.profile === resolvedProfile
        && !this._dirty) {
      return this._snapshot
    }
    this._dirty = false

    if (this._snapshot && this._snapshot.profile !== resolvedProfile) {
      return this.runFullValidation(document, resolvedProfile, currentVersion)
    }

    const snapshotVersion = this._snapshot?.documentVersion ?? -1
    const changes = getChangesSince(document, snapshotVersion)

    if (changes.length === 0) {
      if (this._snapshot) {
        return this._snapshot
      }
      return this.runFullValidation(document, resolvedProfile, currentVersion)
    }

    return this.runIncrementalValidation(document, resolvedProfile, currentVersion, changes)
  }

  validateFresh(document: CampusDocument, profile?: string): ValidationSnapshot {
    const resolvedProfile = (profile ?? getDefaultProfile()) as ValidationProfileId
    const currentVersion = document.version
    this._dirty = false
    return this.runFullValidation(document, resolvedProfile, currentVersion)
  }

  getLastSnapshot(): ValidationSnapshot | undefined {
    return this._snapshot
  }

  onValidationUpdated(cb: (snapshot: ValidationSnapshot) => void): () => void {
    this._listeners.add(cb)
    return () => this._listeners.delete(cb)
  }

  private buildScopedAnalysisCache(
    document: CampusDocument,
    _affectedAffinities: ReadonlySet<string>,
  ): import('./snapshot').AnalysisCache {
    return buildAnalysisCache(document, this.registry.passes)
  }

  private runFullValidation(
    document: CampusDocument,
    profile: ValidationProfileId,
    documentVersion: number,
  ): ValidationSnapshot {
    this._epoch++

    const analysisCache = buildAnalysisCache(document, this.registry.passes)

    const issues: import('./snapshot').ValidationIssue[] = []
    let rulesExecuted = 0
    let rulesPassed = 0
    let rulesFailed = 0

    for (const rule of this.registry.rules) {
      if (!rule.profiles.includes(profile)) continue

      const config = this.resolveProfileConfig(profile, rule.defaults?.tolerances)
      const context: ValidationContext = {
        document,
        profile,
        analysis: analysisCache,
        config,
      }

      rulesExecuted++
      try {
        const result = rule.execute(context)
        const overridden = this.applySeverityOverrides(result, config, rule.ruleId)
        issues.push(...overridden)
        if (result.length === 0) rulesPassed++
      } catch (e) {
        rulesFailed++
        issues.push({
          issueId: `system.engine.${rule.ruleId}`,
          ruleId: rule.ruleId,
          severity: 'error',
          message: `Rule "${rule.ruleId}" crashed: ${e}`,
          targets: [],
        })
      }
    }

    const errors = issues.filter(i => i.severity === 'error').length
    const warnings = issues.filter(i => i.severity === 'warning').length
    const infos = issues.filter(i => i.severity === 'info').length

    const state: import('./snapshot').ValidationState =
      errors > 0 ? 'errors'
      : warnings > 0 ? 'warnings'
      : 'valid'

    this._snapshot = buildSnapshot({
      epoch: this._epoch,
      documentId: document.metadata.campusId,
      documentVersion,
      profile,
      validatedAt: performance.now(),
      state,
      issues,
      statistics: {
        duration: 0,
        totalIssues: issues.length,
        errors,
        warnings,
        infos,
        rulesExecuted,
        rulesReused: 0,
        rulesPassed,
        rulesFailed,
      },
      analysisCache,
    })

    this._notifyListeners()
    return this._snapshot
  }

  private runIncrementalValidation(
    document: CampusDocument,
    profile: ValidationProfileId,
    currentVersion: number,
    changes: readonly EntityChange[],
  ): ValidationSnapshot {
    this._epoch++

    const affectedAffinities = collectAffectedAffinities(changes)
    const analysisCache = this.buildScopedAnalysisCache(document, affectedAffinities)

    const freshIssues: import('./snapshot').ValidationIssue[] = []
    const reRunRuleIds: string[] = []
    let rulesExecuted = 0
    let rulesPassed = 0
    let rulesFailed = 0

    for (const rule of this.registry.rules) {
      if (!rule.profiles.includes(profile)) continue
      if (!isRuleAffected(rule.affinity, affectedAffinities)) continue

      reRunRuleIds.push(rule.ruleId)
      rulesExecuted++

      const config = this.resolveProfileConfig(profile, rule.defaults?.tolerances)
      const context: ValidationContext = {
        document, profile, analysis: analysisCache, config,
      }

      try {
        const result = rule.execute(context)
        const overridden = this.applySeverityOverrides(result, config, rule.ruleId)
        freshIssues.push(...overridden)
        if (result.length === 0) rulesPassed++
      } catch (e) {
        rulesFailed++
        freshIssues.push({
          issueId: `system.engine.${rule.ruleId}`,
          ruleId: rule.ruleId,
          severity: 'error',
          message: `Rule "${rule.ruleId}" crashed: ${e}`,
          targets: [],
        })
      }
    }

    const merged = this.mergeSnapshots(this._snapshot, freshIssues, reRunRuleIds)
    const totalRules = this.registry.rules.filter(r => r.profiles.includes(profile)).length
    const rulesReused = totalRules - rulesExecuted

    const errors = merged.issues.filter(i => i.severity === 'error').length
    const warnings = merged.issues.filter(i => i.severity === 'warning').length
    const infos = merged.issues.filter(i => i.severity === 'info').length

    this._snapshot = buildSnapshot({
      epoch: this._epoch,
      documentId: document.metadata.campusId,
      documentVersion: currentVersion,
      profile,
      validatedAt: performance.now(),
      state: errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'valid',
      issues: merged.issues,
      statistics: {
        duration: 0,
        totalIssues: merged.issues.length,
        errors, warnings, infos,
        rulesExecuted,
        rulesReused,
        rulesPassed,
        rulesFailed,
      },
      analysisCache,
    })

    this._notifyListeners()
    return this._snapshot
  }

  private mergeSnapshots(
    previous: ValidationSnapshot | undefined,
    freshIssues: ReadonlyArray<import('./snapshot').ValidationIssue>,
    reRunRuleIds: ReadonlyArray<string>,
  ): { issues: import('./snapshot').ValidationIssue[] } {
    if (!previous) {
      return { issues: [...freshIssues] }
    }

    const reRunSet = new Set(reRunRuleIds)
    const carried = previous.issues.filter(i => !reRunSet.has(i.ruleId))

    return { issues: [...carried, ...freshIssues] }
  }

  private applySeverityOverrides(
    issues: ReadonlyArray<import('./snapshot').ValidationIssue>,
    config: ProfileConfig,
    ruleId: string,
  ): import('./snapshot').ValidationIssue[] {
    const override = config.severityOverrides[ruleId]
    if (!override) return [...issues]
    return issues.map(i => i.severity !== override ? { ...i, severity: override } : i)
  }

  private resolveProfileConfig(
    profileId: ValidationProfileId,
    ruleDefaults?: Readonly<Record<string, number>>,
  ): ProfileConfig {
    const profile = getProfile(profileId)
    return resolveConfig(profile, ruleDefaults)
  }

  private _notifyListeners(): void {
    if (this._snapshot) {
      for (const cb of this._listeners) {
        cb(this._snapshot)
      }
    }
  }
}

// Cross-entity dependency map: when entity type X changes, rules with affinity
// for dependent entity types Y are also re-run so they don't return stale issues.
// Example: deleting a road affects entrance-connectivity (affinity:entity:entrance).
const ENTITY_DEPENDENTS: Record<string, string[]> = {
  floor: ['building'],
  road: ['entrance'],
}

function isRuleAffected(ruleAffinity: ValidationAffinity, affectedAffinities: ReadonlySet<string>): boolean {
  if (ruleAffinity === 'global') return true
  const entityType = ruleAffinity.replace('entity:', '')
  return affectedAffinities.has(entityType)
}

function collectAffectedAffinities(changes: readonly EntityChange[]): Set<string> {
  const affinities = new Set<string>()
  for (const c of changes) {
    affinities.add(c.entityType)
    const dependents = ENTITY_DEPENDENTS[c.entityType]
    if (dependents) {
      for (const dep of dependents) {
        affinities.add(dep)
      }
    }
  }
  return affinities
}
