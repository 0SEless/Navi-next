import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExplorerSearch } from '../ExplorerSearch'

describe('ExplorerSearch', () => {
  it('renders a search input', () => {
    render(<ExplorerSearch value="" onChange={() => {}} matchCount={0} />)
    expect(screen.getByPlaceholderText('Search entities...')).toBeInTheDocument()
  })

  it('shows match count when results exist', () => {
    render(<ExplorerSearch value="Gym" onChange={() => {}} matchCount={3} />)
    expect(screen.getByText('3')).toBeVisible()
  })

  it('hides match count when zero', () => {
    render(<ExplorerSearch value="" onChange={() => {}} matchCount={0} />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('calls onChange when user types', () => {
    const onChange = vi.fn()
    render(<ExplorerSearch value="" onChange={onChange} matchCount={0} />)
    fireEvent.change(screen.getByPlaceholderText('Search entities...'), { target: { value: 'Hello' } })
    expect(onChange).toHaveBeenCalledWith('Hello')
  })

  it('shows clear button when value is non-empty', () => {
    render(<ExplorerSearch value="test" onChange={() => {}} matchCount={0} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('clears search when clear button clicked', () => {
    const onChange = vi.fn()
    render(<ExplorerSearch value="test" onChange={onChange} matchCount={0} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
