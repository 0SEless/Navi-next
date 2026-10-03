import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  map: {
    id: 'campus-1',
    name: 'Demo Campus',
    schoolName: 'Demo School',
    boundary: [],
    center: { lat: 11.8, lng: 122.1 },
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    stats: { buildings: 0, nodes: 0, edges: 0 },
  },
  loadMapData: vi.fn(),
  reviewerProps: null as Record<string, unknown> | null,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('sessionId=remote-session-1'),
}))

vi.mock('@/components/studio/EditorBridge', () => ({
  EditorBridge: ({ children }: { children: ReactNode }) => <div data-testid="editor-bridge">{children}</div>,
}))

vi.mock('@/store/graph-store', () => ({
  useGraphStore: (selector: (state: unknown) => unknown) => selector({ currentMapId: 'campus-1', loadMapData: mocks.loadMapData }),
}))

vi.mock('@/store/campus-map-store', () => ({
  useCampusMapStore: (selector: (state: unknown) => unknown) => selector({ maps: [mocks.map] }),
}))

vi.mock('@/features/capture-sync/SupabaseCaptureSyncProvider', () => ({
  SupabaseCaptureSyncProvider: ({ children }: { children: ReactNode }) => <div data-testid="capture-sync-provider">{children}</div>,
}))

vi.mock('@/features/capture-review/components/StudioCaptureReviewer', () => ({
  StudioCaptureReviewer: (props: Record<string, unknown>) => {
    mocks.reviewerProps = props
    return <div data-testid="studio-reviewer" />
  },
}))

import StudioCaptureImportPage from './page'

describe('Studio campus Capture Reviewer route', () => {
  it('keeps the editor bridge and passes the remote session query to the Reviewer', async () => {
    await act(async () => {
      render(<StudioCaptureImportPage params={Promise.resolve({ id: 'campus-1' })} />)
    })

    expect(await screen.findByTestId('studio-reviewer')).toBeInTheDocument()
    expect(screen.getByTestId('editor-bridge')).toBeInTheDocument()
    expect(screen.getByTestId('capture-sync-provider')).toBeInTheDocument()
    expect(mocks.reviewerProps).toMatchObject({
      campusMap: mocks.map,
      remoteSessionId: 'remote-session-1',
    })
  })
})
