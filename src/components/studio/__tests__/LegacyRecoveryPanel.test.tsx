import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CampusDocument } from '@navi/core'

const execute = vi.fn()

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'legacy', name: 'legacy', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads: [
      { id: 'road-a', name: 'Main Road', polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
      { id: 'road-b', name: 'Branch Road', polyline: { points: [{ lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }] }, width: 8, surface: 'paved', type: 'arterial', metadata: {} },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}

vi.mock('@navi/editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@navi/editor')>()
  return {
    ...actual,
    useEditor: () => ({
      services: { get: (key: string) => (key === 'dispatcher' ? { execute } : undefined) },
      document: makeDocument(),
    }),
  }
})

import { LegacyRecoveryPanel } from '../LegacyRecoveryPanel'

describe('LegacyRecoveryPanel', () => {
  it('lists a detected coincident connection and applies it on Connect', () => {
    render(<LegacyRecoveryPanel open onClose={() => {}} />)

    expect(screen.getByText(/Main Road/)).not.toBeNull()
    const connect = screen.getByRole('button', { name: 'Connect' })
    fireEvent.click(connect)

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'road.recovery.apply',
      payload: expect.objectContaining({ candidates: expect.any(Array) }),
    }))
    const payload = execute.mock.calls[0][0].payload as { candidates: unknown[] }
    expect(payload.candidates).toHaveLength(1)
  })

  it('renders nothing when closed', () => {
    const { container } = render(<LegacyRecoveryPanel open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
