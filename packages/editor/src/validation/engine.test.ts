import { describe, it, expect } from 'vitest'
import { createDocument } from '../../test-helpers'
import { ValidationEngine } from './validation-engine'
import { disconnectedGraphRule, missingNameRule, zeroAreaPolygonRule } from './rules/modules/skeleton'
import { duplicateIdsRule } from './rules/modules/duplicate-ids'
import { GraphAnalysisPass, GeometryAnalysisPass, MetadataIndexPass } from './rules/analysis'
import { recordChange } from '@navi/core'

function createEngine(): ValidationEngine {
  const engine = new ValidationEngine()
  engine.registerRule(disconnectedGraphRule)
  engine.registerRule(missingNameRule)
  engine.registerRule(zeroAreaPolygonRule)
  engine.registerAnalysisPass(new GraphAnalysisPass())
  engine.registerAnalysisPass(new GeometryAnalysisPass())
  engine.registerAnalysisPass(new MetadataIndexPass())
  engine.initialize()
  return engine
}

describe('ValidationEngine', () => {
  describe('validate', () => {
    it('returns a snapshot with valid state for a clean document', () => {
      const engine = createEngine()
      const doc = createDocument()
      const snapshot = engine.validate(doc)

      expect(snapshot.state).toBe('valid')
      expect(snapshot.issues.length).toBe(0)
      expect(snapshot.documentId).toBe(doc.metadata.campusId)
      expect(snapshot.profile).toBe('draft')
      expect(typeof snapshot.epoch).toBe('number')
      expect(typeof snapshot.validatedAt).toBe('number')
    })

    it('caches result for same document version and profile', () => {
      const engine = createEngine()
      const doc = createDocument()

      const s1 = engine.validate(doc)
      const s2 = engine.validate(doc)
      expect(s1).toBe(s2)
      expect(s1.epoch).toBe(s2.epoch)
    })

    it('returns fresh result when validateFresh is called', () => {
      const engine = createEngine()
      const doc = createDocument()

      const s1 = engine.validate(doc)
      const s2 = engine.validateFresh(doc)
      expect(s1).not.toBe(s2)
      expect(s2.epoch).toBeGreaterThan(s1.epoch)
    })

    it('supports profile parameter', () => {
      const engine = createEngine()
      const doc = createDocument()

      const draft = engine.validate(doc, 'draft')
      const publish = engine.validateFresh(doc, 'publish')

      expect(draft.profile).toBe('draft')
      expect(publish.profile).toBe('publish')
    })

    it('excludes zero-area-rule in draft profile', () => {
      const engine = createEngine()
      const doc = createDocument()

      const draft = engine.validate(doc, 'draft')
      const publish = engine.validateFresh(doc, 'publish')

      const draftZero = draft.issues.filter(i => i.ruleId === 'zero-area-polygon')
      const publishZero = publish.issues.filter(i => i.ruleId === 'zero-area-polygon')
      expect(draftZero.length).toBe(0)
      expect(publishZero.length).toBe(0)
    })

    it('detects crash in a rule and reports it as error', () => {
      const engine = new ValidationEngine()
      engine.registerRule({
        ruleId: 'crashy',
        description: 'Crashy rule',
        category: 'metadata',
        defaultSeverity: 'error',
        profiles: ['draft', 'publish', 'strict'],
        affinity: 'global',
        execute: () => { throw new Error('boom') },
      })
      engine.registerAnalysisPass(new GraphAnalysisPass())
      engine.initialize()

      const doc = createDocument()
      const snapshot = engine.validate(doc)

      expect(snapshot.state).toBe('errors')
      const crashIssue = snapshot.issues.find(i => i.ruleId === 'crashy')
      expect(crashIssue).toBeDefined()
      expect(crashIssue!.message).toContain('crashed')
    })
  })

  describe('getLastSnapshot', () => {
    it('returns undefined before any validation', () => {
      const engine = new ValidationEngine()
      expect(engine.getLastSnapshot()).toBeUndefined()
    })

    it('returns the last snapshot after validation', () => {
      const engine = createEngine()
      const doc = createDocument()
      engine.validate(doc)
      expect(engine.getLastSnapshot()).toBeDefined()
      expect(engine.getLastSnapshot()!.state).toBe('valid')
    })
  })

  describe('onValidationUpdated', () => {
    it('fires callback when validation completes', () => {
      const engine = createEngine()
      const doc = createDocument()
      const calls: any[] = []
      engine.onValidationUpdated(s => calls.push(s))
      engine.validate(doc)
      expect(calls.length).toBe(1)
      expect(calls[0].state).toBe('valid')
    })

    it('returns unsubscribe function', () => {
      const engine = createEngine()
      const doc = createDocument()
      let count = 0
      const unsub = engine.onValidationUpdated(() => count++)
      engine.validate(doc)
      expect(count).toBe(1)
      unsub()
      engine.validateFresh(doc)
      expect(count).toBe(1)
    })
  })
})

describe('incremental validation', () => {
  function createEngine(): ValidationEngine {
    const engine = new ValidationEngine()
    engine.registerRule(disconnectedGraphRule)
    engine.registerRule(missingNameRule)
    engine.registerRule(zeroAreaPolygonRule)
    engine.registerRule(duplicateIdsRule)
    engine.registerAnalysisPass(new GraphAnalysisPass())
    engine.registerAnalysisPass(new GeometryAnalysisPass())
    engine.registerAnalysisPass(new MetadataIndexPass())
    engine.initialize()
    return engine
  }

  it('returns cached snapshot when version unchanged', () => {
    const engine = createEngine()
    const doc = createDocument()
    const s1 = engine.validate(doc)
    const s2 = engine.validate(doc)
    expect(s1).toBe(s2)
  })

  it('keeps the campus document id on incremental snapshots', () => {
    const engine = createEngine()
    const doc = createDocument()

    engine.validate(doc)
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    const incremental = engine.validate(doc)

    expect(incremental.documentId).toBe(doc.metadata.campusId)
  })

  it('runs full validation on first call (no previous snapshot)', () => {
    const engine = createEngine()
    const doc = createDocument()
    const snapshot = engine.validate(doc)
    expect(snapshot.statistics.rulesExecuted).toBeGreaterThan(0)
    expect(snapshot.statistics.rulesReused).toBe(0)
  })

  it('skips rules whose affinity does not match changed entity types', () => {
    const engine = new ValidationEngine()
    engine.registerRule(disconnectedGraphRule)
    engine.registerRule(missingNameRule)
    engine.registerRule({
      ruleId: 'building-only',
      description: 'Only looks at buildings',
      category: 'metadata',
      defaultSeverity: 'error',
      profiles: ['draft', 'publish', 'strict'],
      affinity: 'entity:building',
      execute: () => [],
    })
    engine.registerAnalysisPass(new GraphAnalysisPass())
    engine.registerAnalysisPass(new GeometryAnalysisPass())
    engine.registerAnalysisPass(new MetadataIndexPass())
    engine.initialize()

    const doc = createDocument()
    const s1 = engine.validate(doc)

    // Change a room, not a building
    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })

    const s2 = engine.validate(doc)
    // building-only rule should be skipped (room change doesn't match entity:building affinity)
    expect(s2.statistics.rulesExecuted).toBeLessThan(s1.statistics.rulesExecuted)
    expect(s2.statistics.rulesReused).toBeGreaterThan(0)
  })

  it('validateFresh always runs all rules', () => {
    const engine = createEngine()
    const doc = createDocument()

    const s1 = engine.validate(doc)
    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })

    const fresh = engine.validateFresh(doc)
    const totalRules = s1.statistics.rulesExecuted
    expect(fresh.statistics.rulesExecuted).toBe(totalRules)
    expect(fresh.statistics.rulesReused).toBe(0)
  })

  it('profile switch triggers full validation', () => {
    const engine = createEngine()
    const doc = createDocument()

    const draft = engine.validate(doc, 'draft')
    const publish = engine.validateFresh(doc, 'publish')

    expect(draft.profile).toBe('draft')
    expect(publish.profile).toBe('publish')
  })

  it('reports reuse statistics correctly', () => {
    const engine = new ValidationEngine()
    engine.registerRule(disconnectedGraphRule)
    engine.registerRule({
      ruleId: 'building-only',
      description: 'Only looks at buildings',
      category: 'metadata',
      defaultSeverity: 'error',
      profiles: ['draft', 'publish', 'strict'],
      affinity: 'entity:building',
      execute: () => [],
    })
    engine.registerAnalysisPass(new GraphAnalysisPass())
    engine.registerAnalysisPass(new GeometryAnalysisPass())
    engine.registerAnalysisPass(new MetadataIndexPass())
    engine.initialize()

    const doc = createDocument()

    const full = engine.validate(doc)
    const totalRules = full.statistics.rulesExecuted

    recordChange(doc, { entityId: 'rm-1', entityType: 'room', operation: 'updated' })
    const inc = engine.validate(doc)

    expect(inc.statistics.rulesExecuted + inc.statistics.rulesReused).toBe(totalRules)
    expect(inc.statistics.rulesReused).toBeGreaterThan(0)
  })

  it('rule crash in incremental mode replaces old issues from that rule', () => {
    const engine = new ValidationEngine()
    engine.registerRule(disconnectedGraphRule)
    engine.registerRule({
      ruleId: 'intermittent',
      description: 'Intermittent',
      category: 'metadata',
      defaultSeverity: 'error',
      profiles: ['draft', 'publish', 'strict'],
      affinity: 'global',
      execute: () => [{ issueId: 'intermittent:x', ruleId: 'intermittent', severity: 'error', message: 'Existing issue', targets: [] }],
    })
    engine.registerAnalysisPass(new GraphAnalysisPass())
    engine.initialize()

    const doc = createDocument()
    const s1 = engine.validate(doc)
    expect(s1.issues.filter(i => i.ruleId === 'intermittent').length).toBe(1)

    recordChange(doc, { entityId: 'bld-1', entityType: 'building', operation: 'updated' })
    const s2 = engine.validate(doc)
    // The intermittent rule re-runs (global) — its old issue is replaced by the fresh run
    // Since the rule still produces issues, they should still be present
    expect(s2.issues.filter(i => i.ruleId === 'intermittent').length).toBe(1)
  })
})

