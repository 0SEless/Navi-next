import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContextHeader, type ContextHeaderProps } from '../ContextHeader'

function renderHeader(props?: Partial<ContextHeaderProps>) {
  return render(
    <ContextHeader
      mapId="test-campus"
      buildingName="Engineering Building"
      floorLabel="GF"
      status="saved"
      {...props}
    />,
  )
}

describe('ContextHeader', () => {
  it('renders building name and floor label', () => {
    renderHeader()
    expect(screen.getByText('Engineering Building')).toBeDefined()
    expect(screen.getByText('GF')).toBeDefined()
  })

  it('renders back link to campus workspace', () => {
    renderHeader()
    const link = screen.getByText('Campus').closest('a')
    expect(link?.getAttribute('href')).toBe('/studio/test-campus/edit')
  })

  it('shows saved status', () => {
    renderHeader({ status: 'saved' })
    expect(screen.getByText((c) => c.includes('Saved'))).toBeDefined()
  })

  it('shows saving status', () => {
    renderHeader({ status: 'saving' })
    expect(screen.getByText((c) => c.includes('Saving'))).toBeDefined()
  })

  it('shows checking status while freshness is unconfirmed and never claims Saved', () => {
    renderHeader({ status: 'checking' })
    expect(screen.getByText((c) => c.includes('Checking'))).toBeDefined()
    expect(screen.queryByText((c) => c.includes('Saved'))).toBeNull()
  })

  it('shows error status with message', () => {
    renderHeader({ status: 'error', statusMessage: 'network error' })
    const el = screen.getByText((c) => c.includes('Sync failed'))
    expect(el).toBeDefined()
    expect(el.getAttribute('title')).toBe('network error')
  })

  it('shows conflict status and resolves through the action', () => {
    const onResolveConflict = vi.fn()
    renderHeader({
      status: 'conflict',
      statusMessage: 'server has a different version',
      onResolveConflict,
    })
    const el = screen.getByText((c) => c.includes('Outdated'))
    expect(el).toBeDefined()
    expect(el.getAttribute('title')).toBe('server has a different version')
    fireEvent.click(screen.getByText('Load server version'))
    expect(onResolveConflict).toHaveBeenCalledTimes(1)
  })

  it('does not render a resolve action when no conflict handler is provided', () => {
    renderHeader({ status: 'conflict' })
    expect(screen.queryByText('Load server version')).toBeNull()
  })

  it('shows selection count when > 1', () => {
    renderHeader({ selectedCount: 3 })
    expect(screen.getByText('3 selected')).toBeDefined()
  })

  it('hides selection count when <= 1', () => {
    renderHeader({ selectedCount: 1 })
    expect(screen.queryByText((c) => c.includes('selected'))).toBeNull()
  })

  it('handles empty building name', () => {
    renderHeader({ buildingName: '' })
    expect(screen.getByText('/')).toBeDefined()
  })

  it('renders Save button and triggers onSave callback when clicked', () => {
    const onSave = vi.fn()
    renderHeader({ onSave, status: 'saved' })
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toBeDefined()
    fireEvent.click(btn)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('disables Save button while status is saving', () => {
    const onSave = vi.fn()
    renderHeader({ onSave, status: 'saving' })
    const btn = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
