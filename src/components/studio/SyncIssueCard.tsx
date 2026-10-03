'use client'

import { useState } from 'react'
import { useGraphStore } from '@/store/graph-store'

/**
 * Sync/conflict issue card, rendered inside the EXISTING View Issues surface.
 * Reuses the existing recovery actions only: syncLocalChanges(), adoptServerSnapshot(),
 * reSync({ force: true }). No new sync logic.
 */

export type SyncIssueKind = 'none' | 'local-ahead' | 'divergence' | 'auth' | 'save-failed'

export interface SyncIssue {
  active: boolean
  kind: SyncIssueKind
  title: string
  description: string
  canResync: boolean
}

const DIVERGENCE_MARKER = 'Server and local changes differ'

export function deriveSyncIssue(
  syncStatus: string,
  syncError: string | null | undefined,
): SyncIssue {
  const none: SyncIssue = { active: false, kind: 'none', title: '', description: '', canResync: false }
  if (syncStatus !== 'conflict' && syncStatus !== 'error') return none
  const error = syncError ?? ''

  // Offline keeps its existing passive presentation (no issue card).
  if (syncStatus === 'error' && /^Offline/i.test(error)) return none

  if (syncStatus === 'conflict') {
    if (error.startsWith(DIVERGENCE_MARKER)) {
      return {
        active: true,
        kind: 'divergence',
        title: 'Server and local changes differ',
        description:
          'Both the server and this device contain different changes. Your local work has been preserved to prevent data loss.',
        canResync: false,
      }
    }
    return {
      active: true,
      kind: 'local-ahead',
      title: 'Changes not synced',
      description:
        'Your local changes are preserved but have not been synchronized with the latest acknowledged server version.',
      canResync: true,
    }
  }

  if (/auth|unauthorized|sign in|session|401/i.test(error)) {
    return {
      active: true,
      kind: 'auth',
      title: 'Authentication required',
      description: 'Your current session cannot save changes. Sign in again to continue.',
      canResync: false,
    }
  }

  return {
    active: true,
    kind: 'save-failed',
    title: 'Saving failed',
    description: error || 'Your local changes are preserved; retry when the server is reachable.',
    canResync: false,
  }
}

const buttonBase = {
  padding: '4px 10px',
  fontSize: 11,
  borderRadius: 4,
  cursor: 'pointer',
} as const

export function SyncIssueCard() {
  const syncStatus = useGraphStore((state) => state.syncStatus)
  const syncError = useGraphStore((state) => state.syncError)
  const syncLocalChanges = useGraphStore((state) => state.syncLocalChanges)
  const reSync = useGraphStore((state) => state.reSync)
  const adoptServerSnapshot = useGraphStore((state) => state.adoptServerSnapshot)

  const issue = deriveSyncIssue(syncStatus, syncError)
  const [showReview, setShowReview] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showLoadConfirm, setShowLoadConfirm] = useState(false)
  const [showForceConfirm, setShowForceConfirm] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!issue.active) return null

  const run = (action: () => Promise<void>) => {
    setActionError(null)
    void action().catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : 'Recovery action failed')
    })
  }

  return (
    <div
      data-testid="sync-issue-card"
      style={{ padding: '10px 12px', borderBottom: '1px solid #333', background: '#262626', color: '#e5e7eb', fontSize: 12 }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        <span aria-hidden="true">⚠ </span>
        {issue.title}
      </div>
      <div style={{ color: '#9ca3af', marginBottom: 8 }}>{issue.description}</div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {issue.canResync && (
          <button
            type="button"
            data-testid="sync-issue-resync"
            onClick={() => run(syncLocalChanges)}
            style={{ ...buttonBase, fontWeight: 700, border: '1px solid #f59e0b', background: '#f59e0b', color: '#1f2937' }}
          >
            Re-sync changes
          </button>
        )}
        <button
          type="button"
          data-testid="sync-issue-review"
          onClick={() => setShowReview((visible) => !visible)}
          style={{
            ...buttonBase,
            border: issue.canResync ? '1px solid #4b5563' : '1px solid #f59e0b',
            background: 'transparent',
            color: issue.canResync ? '#d1d5db' : '#f59e0b',
            fontWeight: issue.canResync ? 400 : 700,
          }}
        >
          Review conflict
        </button>
        <button
          type="button"
          aria-label="More"
          data-testid="sync-issue-more"
          aria-expanded={showMore}
          onClick={() => setShowMore((visible) => !visible)}
          style={{ ...buttonBase, border: '1px solid #4b5563', background: 'transparent', color: '#d1d5db' }}
        >
          ⋯
        </button>
      </div>

      {showReview && (
        <div role="region" aria-label="Conflict details" style={{ marginTop: 8, color: '#9ca3af' }}>
          Local and server versions differ. Compare them here before choosing a recovery action; nothing is overwritten automatically.
        </div>
      )}

      {showMore && (
        <div role="menu" aria-label="More recovery actions" style={{ marginTop: 8, display: 'grid', gap: 4 }}>
          <button
            type="button"
            role="menuitem"
            data-testid="sync-issue-load-server"
            onClick={() => {
              setShowLoadConfirm(true)
              setShowMore(false)
            }}
            style={{ ...buttonBase, textAlign: 'left', border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5' }}
          >
            Load server version…
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="sync-issue-advanced"
            onClick={() => {
              setShowAdvanced((visible) => !visible)
              setShowMore(false)
            }}
            style={{ ...buttonBase, textAlign: 'left', border: '1px solid #4b5563', background: 'transparent', color: '#d1d5db' }}
          >
            Advanced recovery
          </button>
        </div>
      )}

      {showAdvanced && (
        <div style={{ marginTop: 8, display: 'grid', gap: 6, justifyItems: 'start' }}>
          {syncError && (
            <span data-testid="sync-issue-diagnostic" style={{ fontSize: 10, color: '#9ca3af', wordBreak: 'break-word' }}>
              {syncError}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowForceConfirm(true)}
            style={{ ...buttonBase, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5' }}
          >
            Force overwrite…
          </button>
        </div>
      )}

      {showLoadConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm load server version"
          style={{ marginTop: 8, padding: 8, background: '#111827', border: '1px solid #374151', borderRadius: 4, display: 'grid', gap: 6 }}
        >
          <strong>Load the server version?</strong>
          <span style={{ color: '#9ca3af' }}>Your preserved local changes may be replaced by the current server version.</span>
          <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowLoadConfirm(false)}>Cancel</button>
            <button
              type="button"
              onClick={() => {
                setShowLoadConfirm(false)
                run(adoptServerSnapshot)
              }}
            >
              Load server version
            </button>
          </span>
        </div>
      )}

      {showForceConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm force overwrite"
          style={{ marginTop: 8, padding: 8, background: '#111827', border: '1px solid #374151', borderRadius: 4, display: 'grid', gap: 6 }}
        >
          <strong>Force overwrite server map?</strong>
          <span style={{ color: '#9ca3af' }}>
            This replaces the server snapshot with the current local graph. Confirm only after reviewing the conflict and creating backups.
          </span>
          <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowForceConfirm(false)}>Cancel</button>
            <button
              type="button"
              onClick={() => {
                setShowForceConfirm(false)
                run(() => reSync({ force: true }))
              }}
            >
              Confirm force overwrite
            </button>
          </span>
        </div>
      )}

      {actionError && (
        <div role="alert" style={{ marginTop: 6, color: '#fca5a5' }}>
          {actionError}
        </div>
      )}
    </div>
  )
}
