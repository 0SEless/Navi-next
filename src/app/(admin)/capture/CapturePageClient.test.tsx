import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCampusMapStore } from '@/store/campus-map-store'
import { CapturePageClient } from './CapturePageClient'

const routerReplace = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/capture',
  useRouter: () => ({ replace: routerReplace }),
}))

vi.mock('@/features/capture-sync/SupabaseCaptureSyncProvider', () => ({
  SupabaseCaptureSyncProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/features/capture/components/CaptureShell', () => ({
  CaptureShell: ({
    campusId,
    campusOptions,
    onCampusChange,
  }: {
    campusId: string | null
    campusOptions: Array<{ id: string; label: string }>
    onCampusChange: (campusId: string | null) => void
  }) => (
    <div>
      <output data-testid="selected-campus">{campusId ?? ''}</output>
      <select
        aria-label="Capture campus"
        value={campusId ?? ''}
        onChange={(event) => onCampusChange(event.target.value || null)}
      >
        <option value="">Choose a campus before syncing</option>
        {campusOptions.map((campus) => <option key={campus.id} value={campus.id}>{campus.label}</option>)}
      </select>
    </div>
  ),
}))

const campusMap = {
  id: 'map-map-1-k6bv',
  name: 'Main campus',
  schoolName: 'NAVI University',
  campusName: 'North campus',
  boundary: [],
  center: { lat: 14.5995, lng: 120.9842 },
  createdAt: '2026-08-31T08:00:00.000Z',
  updatedAt: '2026-08-31T08:00:00.000Z',
  stats: { buildings: 0, nodes: 0, edges: 0 },
}

describe('CapturePageClient', () => {
  beforeEach(() => {
    routerReplace.mockReset()
    localStorage.clear()
    useCampusMapStore.setState({
      maps: [campusMap],
      load: vi.fn(),
    })
  })

  it('preselects a known canonical campus ID from the route', async () => {
    render(<CapturePageClient initialCampusId="map-map-1-k6bv" />)

    await waitFor(() => expect(screen.getByTestId('selected-campus')).toHaveTextContent('map-map-1-k6bv'))
    expect(screen.getByLabelText('Capture campus')).toHaveValue('map-map-1-k6bv')
  })

  it('writes the selected existing campus ID back to the route', async () => {
    render(<CapturePageClient />)

    await waitFor(() => expect(screen.getByRole('option', { name: /main campus/i })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Capture campus'), { target: { value: 'map-map-1-k6bv' } })

    expect(routerReplace).toHaveBeenCalledWith('/capture?campusId=map-map-1-k6bv')
  })
})
