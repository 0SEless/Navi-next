import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  map: {
    id: 'campus-1',
    name: 'Demo Campus',
    schoolName: 'Demo School',
    campusName: 'Main Campus',
    boundary: [],
    center: { lat: 11.8, lng: 122.1 },
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    stats: { buildings: 0, nodes: 0, edges: 0 },
  },
  load: vi.fn(),
}))

vi.mock('@/store/campus-map-store', () => ({
  useCampusMapStore: (selector: (state: unknown) => unknown) => selector({ maps: [mocks.map], load: mocks.load }),
}))

vi.mock('@/features/capture-sync/SupabaseCaptureSyncProvider', () => ({
  SupabaseCaptureSyncProvider: ({ children }: { children: ReactNode }) => <div data-testid="capture-sync-provider">{children}</div>,
}))

vi.mock('@/features/capture-library/components/StudioCaptureLibrary', () => ({
  StudioCaptureLibrary: ({ campusId, campusLabel }: { campusId: string; campusLabel: string }) => (
    <h1>Capture Library for {campusLabel} ({campusId})</h1>
  ),
}))

import CaptureLibraryPage from './page'

describe('Studio campus Capture Library route', () => {
  it('renders the campus-scoped Library without mounting the editor', async () => {
    await act(async () => {
      render(<CaptureLibraryPage params={Promise.resolve({ id: 'campus-1' })} />)
    })

    expect(await screen.findByRole('heading', { name: 'Capture Library for Demo Campus · Main Campus (campus-1)' })).toBeInTheDocument()
    expect(screen.getByTestId('capture-sync-provider')).toBeInTheDocument()
    expect(mocks.load).toHaveBeenCalled()
  })

  it('fails closed when the requested campus is not loaded', async () => {
    await act(async () => {
      render(<CaptureLibraryPage params={Promise.resolve({ id: 'missing-campus' })} />)
    })

    expect(await screen.findByText('Map not found')).toBeInTheDocument()
  })
})
