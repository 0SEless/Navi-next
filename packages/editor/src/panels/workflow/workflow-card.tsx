'use client'

import { useState } from 'react'
import { useWorkflow } from './use-workflow'
import { usePublish } from './use-publish'

// ── Style constants ───────────────────────────────────────────

const styles = {
  container: {
    padding: 12,
    fontSize: 13,
    fontFamily: 'system-ui, sans-serif',
    color: '#1a1a1a',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  header: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 4,
  },
  progressBar: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    background: '#e5e7eb',
    overflow: 'hidden' as const,
  },
  progressFill: (pct: number) => ({
    width: `${pct}%`,
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease',
    background: pct === 100 ? '#16a34a' : '#2563eb',
  }),
  step: {
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: '4px 0',
    borderBottom: '1px solid #f0f0f0',
  },
  stepLabel: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: 6,
  },
  indicator: (color: string) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }),
  button: {
    padding: '2px 10px',
    fontSize: 12,
    border: '1px solid #d0d0d0',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
  },
  buttonDisabled: {
    padding: '2px 10px',
    fontSize: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    background: '#f9fafb',
    color: '#9ca3af',
    cursor: 'default',
  },
  nextAction: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
    marginTop: 4,
  },
  dirtyBadge: {
    fontSize: 11,
    background: '#fef3cd',
    color: '#856404',
    padding: '2px 8px',
    borderRadius: 4,
    display: 'inline-block',
  },
}

// ── Status helpers ────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'success': return '#16a34a'
    case 'error': return '#dc2626'
    case 'waiting': return '#9ca3af'
    default: return '#d0d0d0'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'success': return '✓'
    case 'error': return '✗'
    case 'waiting': return '⋯'
    default: return '○'
  }
}

function publishColor(state: string): string {
  switch (state) {
    case 'success': return '#16a34a'
    case 'error': return '#dc2626'
    case 'preparing':
    case 'validating':
    case 'compiling':
    case 'uploading': return '#2563eb'
    default: return '#d0d0d0'
  }
}

// ── WorkflowCard ──────────────────────────────────────────────

/**
 * Workflow orchestration card for the Studio workspace.
 *
 * Replaces the PropertiesPanel placeholder when no entity is selected.
 * Shows validation, compile, save, and publish status with action buttons.
 */
export function WorkflowCard() {
  const {
    steps,
    percent,
    nextAction,
    validate,
    compile,
    save,
    isDirty,
  } = useWorkflow()

  const { snapshot: publishSnap, publish: handlePublishNew } = usePublish()

  const [busy, setBusy] = useState<string | null>(null)

  async function handleValidate() {
    setBusy('validate')
    try { await validate() } finally { setBusy(null) }
  }

  async function handleCompile() {
    setBusy('compile')
    try { await compile() } finally { setBusy(null) }
  }

  async function handleSave() {
    setBusy('save')
    try { await save() } finally { setBusy(null) }
  }

  async function handlePublish() {
    setBusy('publish')
    try { await handlePublishNew() } finally { setBusy(null) }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>Workflow</div>

      {/* Progress bar */}
      <div style={styles.progressBar}>
        <div style={styles.progressFill(percent)} />
      </div>

      {/* Dirty indicator */}
      {isDirty && (
        <div style={styles.dirtyBadge}>
          Unsaved changes
        </div>
      )}

      {/* Validation step */}
      <div style={styles.step}>
        <div style={styles.stepLabel}>
          <span style={styles.indicator(statusColor(steps.validation.status))} />
          <span>Validate</span>
        </div>
        <button
          style={busy === 'validate' ? styles.buttonDisabled : styles.button}
          onClick={handleValidate}
          disabled={busy !== null}
        >
          {busy === 'validate' ? '⋯' : statusLabel(steps.validation.status) || 'Validate'}
        </button>
      </div>

      {/* Compile step */}
      <div style={styles.step}>
        <div style={styles.stepLabel}>
          <span style={styles.indicator(statusColor(steps.compile.status))} />
          <span>Compile</span>
        </div>
        <button
          style={busy === 'compile' ? styles.buttonDisabled : styles.button}
          onClick={handleCompile}
          disabled={busy !== null}
        >
          {busy === 'compile' ? '⋯' : statusLabel(steps.compile.status) || 'Compile'}
        </button>
      </div>

      {/* Save step */}
      <div style={styles.step}>
        <div style={styles.stepLabel}>
          <span style={styles.indicator(statusColor(steps.save.status))} />
          <span>Save</span>
        </div>
        <button
          style={busy === 'save' ? styles.buttonDisabled : styles.button}
          onClick={handleSave}
          disabled={busy !== null}
        >
          {busy === 'save' ? '⋯' : statusLabel(steps.save.status) || 'Save'}
        </button>
      </div>

      {/* Publish step */}
      <div style={styles.step}>
        <div style={styles.stepLabel}>
          <span style={styles.indicator(publishColor(publishSnap.publishState))} />
          <span>Publish</span>
        </div>
        <button
          style={busy === 'publish' ? styles.buttonDisabled : styles.button}
          onClick={handlePublish}
          disabled={busy !== null}
        >
          {publishSnap.publishState === 'success' ? '✓ Published' :
           publishSnap.publishState === 'error' ? '✗ Failed' :
           publishSnap.publishState !== 'idle' ? '...' :
           busy === 'publish' ? '...' : 'Publish'}
        </button>
      </div>

      {/* Next action hint */}
      {nextAction && (
        <div style={styles.nextAction}>
          Next: {nextAction}
        </div>
      )}
    </div>
  )
}
