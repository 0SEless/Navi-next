import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../../context'
import { QRProperties } from './qr-props'

afterEach(cleanup)

function createQR(overrides = {}) {
  return {
    id: 'qr-1',
    label: 'QR-001',
    code: 'navi://floor/0/room/101',
    ...overrides,
  }
}

function renderWithDispatcher(qr: any, execute = vi.fn()) {
  const services = {
    get: (name: string) => (name === 'dispatcher' ? { execute } : undefined),
  }
  return { execute, ...render(
    <EditorProvider context={{ document: {} as any, services }}>
      <QRProperties qr={qr} />
    </EditorProvider>,
  ) }
}

describe('QRProperties', () => {
  it('renders QR Checkpoint header and fields', () => {
    renderWithDispatcher(createQR())
    expect(screen.getByText('Details')).toBeDefined()
    expect(screen.getByDisplayValue('QR-001')).toBeDefined()
    expect(screen.getByDisplayValue('navi://floor/0/room/101')).toBeDefined()
  })

  it('dispatches entity.update when label changes', () => {
    const { execute } = renderWithDispatcher(createQR())
    fireEvent.change(screen.getByDisplayValue('QR-001'), { target: { value: 'QR-002' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit QR',
      payload: { entityId: 'qr-1', changes: { label: 'QR-002' } },
    })
  })
})
