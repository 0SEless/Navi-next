import { describe, it, expect } from 'vitest'
import { computeProgress } from '../workflow-progress'
import type { WorkflowSnapshot } from '../../../services/workflow-store'

const baseSnapshot: WorkflowSnapshot = {
  version: 0,
  lastValidation: null,
  lastCompile: null,
  lastSave: null,
  lastPublish: null,
  syncStatus: 'idle',
  lastSaveVersion: 0,
  saveState: 'idle',
  saveError: null,
  lastSaveReason: null,
  lastSavedAt: 0,
}

describe('computeProgress', () => {
  it('all pending when snapshot is empty', () => {
    const p = computeProgress(baseSnapshot)
    expect(p.steps.validation.status).toBe('pending')
    expect(p.steps.compile.status).toBe('waiting')  // depends on validation
    expect(p.steps.save.status).toBe('pending')
    expect(p.steps.publish.status).toBe('waiting')  // depends on compile
    expect(p.percent).toBe(0)
    expect(p.nextAction).toBe('Validate your campus')
  })

  it('validation success unlocks compile', () => {
    const p = computeProgress({
      ...baseSnapshot,
      lastValidation: { passed: 10, failed: 0, errors: [], timestamp: 100 },
    })
    expect(p.steps.validation.status).toBe('success')
    expect(p.steps.compile.status).toBe('pending')   // not waiting anymore
    expect(p.percent).toBe(25)
    expect(p.nextAction).toBe('Compile navigation graph')
  })

  it('validation error blocks compile and publish', () => {
    const p = computeProgress({
      ...baseSnapshot,
      lastValidation: { passed: 5, failed: 3, errors: ['err1'], timestamp: 100 },
    })
    expect(p.steps.validation.status).toBe('error')
    expect(p.steps.compile.status).toBe('waiting')
    expect(p.steps.publish.status).toBe('waiting')
    expect(p.nextAction).toBe('Fix validation issues')
  })

  it('compile success unlocks publish', () => {
    const p = computeProgress({
      ...baseSnapshot,
      lastValidation: { passed: 10, failed: 0, errors: [], timestamp: 100 },
      lastCompile: { status: 'success', timestamp: 200, artifacts: { navigationGraph: {}, searchIndex: null, poiData: null, buildingIndex: null } },
    })
    expect(p.steps.compile.status).toBe('success')
    expect(p.steps.publish.status).toBe('pending')
    expect(p.percent).toBe(50)
    expect(p.nextAction).toBe('Save your changes')
  })

  it('compile error blocks publish', () => {
    const p = computeProgress({
      ...baseSnapshot,
      lastValidation: { passed: 10, failed: 0, errors: [], timestamp: 100 },
      lastCompile: { status: 'error', message: 'Build failed', timestamp: 200 },
    })
    expect(p.steps.compile.status).toBe('error')
    expect(p.steps.publish.status).toBe('waiting')
    expect(p.nextAction).toBe('Fix compilation errors')
  })

  it('save success tracked', () => {
    const p = computeProgress({
      ...baseSnapshot,
      lastSave: { timestamp: 300, reason: 'manual' },
    })
    expect(p.steps.save.status).toBe('success')
    expect(p.percent).toBe(25)  // save is 25%
  })

  it('publish success shows full progress', () => {
    const p = computeProgress({
      ...baseSnapshot,
      lastValidation: { passed: 10, failed: 0, errors: [], timestamp: 100 },
      lastCompile: { status: 'success', timestamp: 200, artifacts: { navigationGraph: {}, searchIndex: null, poiData: null, buildingIndex: null } },
      lastSave: { timestamp: 300, reason: 'manual' },
      lastPublish: { timestamp: 400 },
    })
    expect(p.steps.validation.status).toBe('success')
    expect(p.steps.compile.status).toBe('success')
    expect(p.steps.save.status).toBe('success')
    expect(p.steps.publish.status).toBe('success')
    expect(p.percent).toBe(100)
    expect(p.nextAction).toBeNull()
  })

  it('publish waiting when document dirty after compile', () => {
    const p = computeProgress(
      {
        ...baseSnapshot,
        lastValidation: { passed: 10, failed: 0, errors: [], timestamp: 100 },
        lastCompile: { status: 'success', timestamp: 200, artifacts: { navigationGraph: {}, searchIndex: null, poiData: null, buildingIndex: null } },
        lastSave: { timestamp: 300, reason: 'manual' },
      },
      true, // isDirty
    )
    expect(p.steps.publish.status).toBe('waiting')
    expect(p.steps.publish.message).toBe('Save required before publish')
  })

  it('percent calculation includes error states at full weight', () => {
    const p = computeProgress({
      ...baseSnapshot,
      lastValidation: { passed: 0, failed: 5, errors: ['e'], timestamp: 100 },
    })
    // validation error = 25% (error counts as attempted), others 0
    expect(p.percent).toBe(25)
  })
})
