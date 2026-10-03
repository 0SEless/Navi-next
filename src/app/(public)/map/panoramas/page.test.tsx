import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { CampusBundle } from '@/types/nav-types'
import { usePublicStore } from '@/store/public-store'
import PanoramasPage from './page'

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mocks.back }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock('@/components/tour/TourViewer', () => ({
  TourViewer: ({ panoramas }: { panoramas: Array<{ id: string; imageUrl: string }> }) => (
    <div
      data-testid="tour-viewer"
      data-panorama-ids={panoramas.map(panorama => panorama.id).join(',')}
      data-image-urls={panoramas.map(panorama => panorama.imageUrl).join(',')}
    />
  ),
}))

const baseBundle = {
  nodes: [],
  edges: [],
  searchEntries: [],
  buildings: [],
  components: [],
  poi: [],
  boundingBox: null,
  panoramaIndex: {
    version: '1',
    panoramas: [
      {
        id: 'pano-b1',
        title: 'Library lobby',
        imageAssetId: 'asset-library-lobby',
        buildingId: 'b1',
        floor: 1,
        position: { lat: 11.82, lng: 122.168 },
        hotspots: [],
      },
      {
        id: 'pano-b2',
        title: 'Hall',
        imageAssetId: 'asset-hall',
        buildingId: 'b2',
        floor: 1,
        position: { lat: 11.82, lng: 122.168 },
        hotspots: [],
      },
      {
        id: 'pano-no-asset',
        title: 'Draft panorama',
        imageAssetId: '',
        buildingId: 'b1',
        position: { lat: 11.82, lng: 122.168 },
        hotspots: [],
      },
    ],
  },
} satisfies CampusBundle

function setCampus(bundle: CampusBundle) {
  usePublicStore.setState({
    campus: bundle,
    campusLoading: false,
    campusError: null,
  })
}

afterEach(() => {
  cleanup()
  mocks.searchParams = new URLSearchParams()
  mocks.back.mockReset()
  usePublicStore.setState({ campus: null, campusLoading: false, campusError: null })
})

describe('PanoramasPage published tour boundary', () => {
  it('filters to the requested building/panorama and never creates placeholder URLs', () => {
    mocks.searchParams = new URLSearchParams('building_id=b1&panorama_id=pano-b1')
    setCampus(baseBundle)

    render(<PanoramasPage />)

    expect(screen.getByTestId('tour-viewer')).toHaveAttribute('data-panorama-ids', 'pano-b1')
    expect(screen.getByTestId('tour-viewer')).toHaveAttribute('data-image-urls', 'asset-library-lobby')
    expect(screen.queryByText(/picsum/i)).toBeNull()
  })

  it('shows the published empty state when no panorama has a real asset', () => {
    setCampus({
      ...baseBundle,
      panoramaIndex: {
        version: '1',
        panoramas: [baseBundle.panoramaIndex!.panoramas[2]],
      },
    })

    render(<PanoramasPage />)

    expect(screen.getByRole('heading', { name: 'No 360 Tour Available' })).toBeInTheDocument()
    expect(screen.queryByTestId('tour-viewer')).toBeNull()
  })
})
