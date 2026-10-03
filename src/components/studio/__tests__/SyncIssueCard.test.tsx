import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

/**
 * Focused tests: sync recovery moved into the existing View Issues surface.
 * Covers: no-issue state, local-ahead card, divergence, auth, more menu,
 * load-server confirmation, resync wiring, and the View Issues warning badge.
 */

const state = vi.hoisted(() => ({
  graph: {
    syncStatus: 'synced' as string,
    syncError: null as string | null,
    syncLocalChanges: vi.fn().mockResolvedValue(undefined),
    reSync: vi.fn().mockResolvedValue(undefined),
    adoptServerSnapshot: vi.fn().mockResolvedValue(undefined),
  },
  workflow: {
    steps: { validation: { status: 'idle' } },
    percent: 0,
    validate: vi.fn().mockResolvedValue(undefined),
  },
  editor: {
    services: { get: () => null },
  },
}))

vi.mock('@/store/graph-store', () => ({
  useGraphStore: Object.assign(
    (selector: (value: typeof state.graph) => unknown) => selector(state.graph),
    { getState: () => state.graph },
  ),
}))

vi.mock('@navi/editor', () => ({
  useWorkflow: () => state.workflow,
  useEditor: () => state.editor,
}))

import { SyncIssueCard, deriveSyncIssue } from '../SyncIssueCard'
import { BuildStatus } from '../BuildStatus'

describe('deriveSyncIssue', () => {
  it('no issue when synced or offline', () => {
    expect(deriveSyncIssue('synced', null).active).toBe(false)
    expect(deriveSyncIssue('error', 'Offline — could not verify the server copy.').active).toBe(false)
  })
  it('local-ahead conflict can resync; divergence cannot', () => {
    const localAhead = deriveSyncIssue('conflict', 'The server has a different version of this map (2026-09-13T...).')
    expect(localAhead.kind).toBe('local-ahead')
    expect(localAhead.canResync).toBe(true)
    const divergence = deriveSyncIssue('conflict', 'Server and local changes differ. Your local work is preserved.')
    expect(divergence.kind).toBe('divergence')
    expect(divergence.canResync).toBe(false)
  })
  it('auth failures are distinguished from version conflicts', () => {
    const auth = deriveSyncIssue('error', 'Unauthorized: session expired. Sign in again.')
    expect(auth.kind).toBe('auth')
    expect(auth.canResync).toBe(false)
    expect(auth.title).toBe('Authentication required')
  })
  it('generic failures show Saving failed', () => {
    const failed = deriveSyncIssue('error', 'server exploded')
    expect(failed.kind).toBe('save-failed')
    expect(failed.canResync).toBe(false)
  })
})

describe('SyncIssueCard inside View Issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.graph.syncStatus = 'synced'
    state.graph.syncError = null
  })

  it('renders nothing when there is no sync issue', () => {
    const { container } = render(<SyncIssueCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('local-ahead: Re-sync primary, Review conflict secondary, More menu with both advanced actions', () => {
    state.graph.syncStatus = 'conflict'
    state.graph.syncError = 'The server has a different version of this map (2026-09-13T...).'
    const { getByText, getByTestId, queryByTestId } = render(<SyncIssueCard />)

    expect(getByText('Changes not synced')).toBeInTheDocument()
    expect(getByTestId('sync-issue-resync')).toBeInTheDocument()
    expect(getByTestId('sync-issue-review')).toBeInTheDocument()
    expect(queryByTestId('sync-issue-load-server')).not.toBeInTheDocument()
    expect(queryByTestId('sync-issue-advanced')).not.toBeInTheDocument()

    fireEvent.click(getByTestId('sync-issue-more'))
    expect(getByTestId('sync-issue-load-server')).toBeInTheDocument()
    expect(getByTestId('sync-issue-advanced')).toBeInTheDocument()
  })

  it('Re-sync changes invokes the existing syncLocalChanges action', () => {
    state.graph.syncStatus = 'conflict'
    state.graph.syncError = 'The server has a different version of this map (2026-09-13T...).'
    const { getByTestId } = render(<SyncIssueCard />)
    fireEvent.click(getByTestId('sync-issue-resync'))
    expect(state.graph.syncLocalChanges).toHaveBeenCalledTimes(1)
  })

  it('divergence: Review conflict emphasized, Re-sync not offered, no automatic overwrite', () => {
    state.graph.syncStatus = 'conflict'
    state.graph.syncError = 'Server and local changes differ. Your local work is preserved.'
    const { getByText, getByTestId, queryByTestId } = render(<SyncIssueCard />)
    expect(getByText('Server and local changes differ')).toBeInTheDocument()
    expect(getByTestId('sync-issue-review')).toBeInTheDocument()
    expect(queryByTestId('sync-issue-resync')).not.toBeInTheDocument()
    expect(state.graph.reSync).not.toHaveBeenCalled()
    expect(state.graph.adoptServerSnapshot).not.toHaveBeenCalled()
  })

  it('auth failure: Authentication required, no Re-sync solution', () => {
    state.graph.syncStatus = 'error'
    state.graph.syncError = 'Unauthorized: session expired. Sign in again.'
    const { getByText, queryByTestId } = render(<SyncIssueCard />)
    expect(getByText('Authentication required')).toBeInTheDocument()
    expect(queryByTestId('sync-issue-resync')).not.toBeInTheDocument()
  })

  it('Load server version requires confirmation; Cancel does nothing', () => {
    state.graph.syncStatus = 'conflict'
    state.graph.syncError = 'The server has a different version of this map (2026-09-13T...).'
    const { getByTestId, getByText, getByRole, queryByRole } = render(<SyncIssueCard />)

    fireEvent.click(getByTestId('sync-issue-more'))
    fireEvent.click(getByTestId('sync-issue-load-server'))
    expect(getByText('Load the server version?')).toBeInTheDocument()
    fireEvent.click(getByRole('button', { name: 'Cancel' }))
    expect(queryByRole('dialog')).not.toBeInTheDocument()
    expect(state.graph.adoptServerSnapshot).not.toHaveBeenCalled()
  })

  it('Advanced recovery keeps its deliberate force-overwrite confirmation', () => {
    state.graph.syncStatus = 'conflict'
    state.graph.syncError = 'The server has a different version of this map (2026-09-13T...).'
    const { getByTestId, getByRole, getByText } = render(<SyncIssueCard />)

    fireEvent.click(getByTestId('sync-issue-more'))
    fireEvent.click(getByTestId('sync-issue-advanced'))
    expect(getByText('The server has a different version of this map (2026-09-13T...).')).toBeInTheDocument()
    fireEvent.click(getByRole('button', { name: 'Force overwrite…' }))
    fireEvent.click(getByRole('button', { name: 'Confirm force overwrite' }))
    expect(state.graph.reSync).toHaveBeenCalledWith({ force: true })
  })
})

describe('BuildStatus View Issues indicator', () => {
  it('normal when no issues; warning badge with count when issues exist', () => {
    const clean = render(<BuildStatus onOpenProblems={() => {}} problemCount={0} />)
    expect(clean.getByRole('button', { name: 'View issues' })).toBeInTheDocument()
    clean.unmount()

    const badge = render(<BuildStatus onOpenProblems={() => {}} problemCount={3} />)
    expect(badge.getByRole('button', { name: '⚠ View issues (3)' })).toBeInTheDocument()
  })
})
