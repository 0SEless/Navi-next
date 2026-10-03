import type { WorkflowSnapshot } from '../../services/workflow-store'

// ── Types ─────────────────────────────────────────────────────

export interface StepState {
  status: 'pending' | 'success' | 'error' | 'waiting'
  message?: string
}

export interface WorkflowProgress {
  steps: {
    validation: StepState
    compile: StepState
    save: StepState
    publish: StepState
  }
  /** Overall progress 0–100 */
  percent: number
  /** Label for the current blocking step, e.g. "Validate your campus" */
  nextAction: string | null
}

// ── computeProgress ───────────────────────────────────────────

/**
 * Pure function that derives UI state from a WorkflowSnapshot.
 *
 * Rules:
 * - validation: independent. Shows error if any failures.
 * - compile: depends on validation passing. Shows 'waiting' if
 *   validation hasn't passed.
 * - save: independent. Tracked via lastSave.
 * - publish: depends on compile success. Also shows 'waiting' if
 *   compile hasn't succeeded or document is dirty.
 *
 * @param snapshot - Current workflow state
 * @param isDirty - Whether the document has unsaved changes
 *   (computed by WorkflowService which has access to DocumentStore)
 *
 * percent = weighted average of 4 steps (25% each).
 */
export function computeProgress(snapshot: WorkflowSnapshot, isDirty = false): WorkflowProgress {
  const steps = {
    validation: computeValidationState(snapshot),
    compile: computeCompileState(snapshot),
    save: computeSaveState(snapshot),
    publish: computePublishState(snapshot, isDirty),
  }

  const weights = { validation: 25, compile: 25, save: 25, publish: 25 }
  let total = 0
  for (const [key, step] of Object.entries(steps)) {
    if (step.status === 'success') total += weights[key as keyof typeof weights]
    if (step.status === 'error') total += weights[key as keyof typeof weights] // full weight for attempted-but-failed
    if (step.status === 'waiting') total += 0
  }
  const percent = Math.round(total)

  // Next action
  const nextAction = determineNextAction(steps, snapshot)

  return { steps, percent, nextAction }
}

// ── Step helpers ──────────────────────────────────────────────

function computeValidationState(snapshot: WorkflowSnapshot): StepState {
  if (!snapshot.lastValidation) {
    return { status: 'pending', message: 'Not yet validated' }
  }
  if (snapshot.lastValidation.failed > 0) {
    return {
      status: 'error',
      message: `${snapshot.lastValidation.failed} issue${snapshot.lastValidation.failed === 1 ? '' : 's'} found`,
    }
  }
  return { status: 'success', message: `All checks passed` }
}

function computeCompileState(snapshot: WorkflowSnapshot): StepState {
  if (!snapshot.lastValidation || snapshot.lastValidation.failed > 0) {
    return { status: 'waiting', message: 'Validating required' }
  }
  if (!snapshot.lastCompile) {
    return { status: 'pending', message: 'Not yet compiled' }
  }
  if (snapshot.lastCompile.status === 'error') {
    return { status: 'error', message: snapshot.lastCompile.message ?? 'Compilation failed' }
  }
  return { status: 'success', message: 'Compiled successfully' }
}

function computeSaveState(snapshot: WorkflowSnapshot): StepState {
  if (!snapshot.lastSave) {
    return { status: 'pending', message: 'Not yet saved' }
  }
  return { status: 'success' }
}

function computePublishState(snapshot: WorkflowSnapshot, isDirty = false): StepState {
  const compileOk = snapshot.lastCompile?.status === 'success'

  if (!compileOk) {
    return { status: 'waiting', message: 'Compilation required' }
  }
  if (isDirty) {
    return { status: 'waiting', message: 'Save required before publish' }
  }
  if (!snapshot.lastPublish) {
    return { status: 'pending', message: 'Not yet published' }
  }
  return { status: 'success', message: 'Published' }
}

function determineNextAction(
  steps: WorkflowProgress['steps'],
  snapshot: WorkflowSnapshot,
): string | null {
  if (steps.validation.status === 'pending') return 'Validate your campus'
  if (steps.validation.status === 'error') return 'Fix validation issues'
  if (steps.compile.status === 'pending') return 'Compile navigation graph'
  if (steps.compile.status === 'error') return 'Fix compilation errors'
  if (steps.save.status === 'pending') return 'Save your changes'
  return null
}
