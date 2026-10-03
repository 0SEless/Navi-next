'use client'

import { useWorkflow } from '@navi/editor'
import { useGraphStore } from '@/store/graph-store'
import { getSaveStatusModel } from './save-status-model'

/**
 * Compact save-state indicator for the Studio toolbar.
 *
 * Recovery actions are intentionally NOT rendered here (toolbar stays clean).
 * Sync/conflict recovery now lives inside the existing View Issues surface via
 * SyncIssueCard.
 */
export function SaveStatus() {
  const { snapshot } = useWorkflow()
  const syncStatus = useGraphStore((state) => state.syncStatus)
  const syncError = useGraphStore((state) => state.syncError)

  const status = getSaveStatusModel({
    saveState: snapshot.saveState,
    syncStatus,
    syncError,
    saveError: snapshot.saveError,
  })

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        color: status.color,
        fontWeight: 500,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.color, flexShrink: 0 }} />
      <span>{status.label}</span>
      {status.detail && (
        <span
          data-testid="save-status-detail"
          style={{ fontWeight: 400, maxWidth: 360, color: 'var(--navi-text-secondary)' }}
        >
          {status.detail}
        </span>
      )}
    </div>
  )
}
