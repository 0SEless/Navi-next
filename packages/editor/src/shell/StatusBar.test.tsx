// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusBar } from './StatusBar'

afterEach(cleanup)

describe('StatusBar', () => {
  it('renders tool name', () => {
    render(<StatusBar activeTool="Select" />)
    expect(screen.getByText('Select')).toBeDefined()
  })

  it('renders selection count', () => {
    render(<StatusBar selectionCount={3} />)
    expect(screen.getByText('3 selected')).toBeDefined()
  })

  it('renders building count', () => {
    render(<StatusBar buildingCount={5} />)
    expect(screen.getByText('5 buildings')).toBeDefined()
  })

  it('renders problem count only when > 0', () => {
    render(<StatusBar problemCount={3} />)
    expect(screen.getByText('3 problems')).toBeDefined()
  })

  it('renders zoom level', () => {
    render(<StatusBar zoom={15.5} />)
    expect(screen.getByText(/Zoom:/)).toBeDefined()
  })
})
