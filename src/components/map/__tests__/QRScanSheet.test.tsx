import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QRScanSheet } from '../QRScanSheet'
import { usePublicStore } from '@/store/public-store'
import type { QrLocation } from '@/lib/qr-location'
import type { CampusBundle } from '@/types/nav-types'

vi.mock('@/components/map/QRScanner', () => ({
  QRScanner: ({ onPayload }: { onPayload?: (payload: string) => void }) => (
    <div>
      <button type="button" onClick={() => onPayload?.('navi.app/q/checkpoint-1')}>
        Mock valid scan
      </button>
      <button type="button" onClick={() => onPayload?.('javascript:alert(1)')}>
        Mock malformed scan
      </button>
    </div>
  ),
}))

afterEach(cleanup)

const campus: CampusBundle = {
  nodes: [{
    id: 'qr-node',
    label: 'Main Entrance',
    position: { lat: 10, lng: 20 },
    floor: 0,
    buildingId: 'building-1',
    campusId: 'test-campus',
    type: 'entrance',
    metadata: { entityType: 'qr', entityId: 'checkpoint-1' },
  }],
  edges: [],
  searchEntries: [],
  buildings: [],
  poi: [],
  boundingBox: null,
  qrIndex: {
    schemaVersion: 1,
    formatVersion: 1,
    campusId: 'test-campus',
    checkpoints: [{
      id: 'checkpoint-1',
      label: 'Main Entrance',
      buildingId: 'building-1',
      floor: 0,
      position: { x: 0, y: 0 },
      code: 'navi.app/q/checkpoint-1',
    }],
  },
}

beforeEach(() => {
  usePublicStore.setState({
    campus,
    currentCampusId: 'test-campus',
    campusData: {
      campusId: 'test-campus',
      source: 'published_maps',
      buildings: [],
      components: [],
      nodes: campus.nodes,
      edges: [],
    },
    qrLocation: null,
  })
})

describe('QRScanSheet', () => {
  it('resolves camera payloads through the shared QR location contract', () => {
    const onResolved = vi.fn<(location: QrLocation, mode: 'start' | 'destination') => void>()
    const onClose = vi.fn()
    render(<QRScanSheet open onClose={onClose} onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mock valid scan' }))

    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({
      source: 'qr',
      campusId: 'test-campus',
      checkpointId: 'checkpoint-1',
      nodeId: 'qr-node',
      anchor: 'graph-node',
    }), 'start')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps malformed payloads inside the accessible scanner error surface', () => {
    render(<QRScanSheet open onClose={vi.fn()} onResolved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mock malformed scan' }))

    expect(screen.getByRole('alert')).toHaveTextContent('QR code could not be resolved')
  })

  it('keeps scanner recovery controls keyboard- and touch-sized', () => {
    render(<QRScanSheet open onClose={vi.fn()} onResolved={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Close scanner' }).className).toContain('h-11')
    expect(screen.getByRole('button', { name: 'Use as start point' }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: 'Use as destination' }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: 'Use' }).className).toContain('min-h-11')
    expect(screen.getByRole('textbox', { name: 'Paste NAVI code' }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: 'Use as start point' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Use as destination' })).toHaveAttribute('aria-pressed', 'false')
  })
})
