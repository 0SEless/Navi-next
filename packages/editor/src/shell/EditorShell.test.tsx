// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EditorShell } from './EditorShell'

afterEach(cleanup)

describe('EditorShell', () => {
  it('renders canvas area', () => {
    render(<EditorShell canvas={<div data-testid="canvas" />} />)
    expect(screen.getByTestId('canvas')).toBeDefined()
  })

  it('renders with left panel', () => {
    render(
      <EditorShell
        canvas={<div />}
        leftPanel={<div data-testid="left-panel" />}
      />,
    )
    expect(screen.getByTestId('left-panel')).toBeDefined()
  })

  it('renders with right panel', () => {
    render(
      <EditorShell
        canvas={<div />}
        rightPanel={<div data-testid="right-panel" />}
      />,
    )
    expect(screen.getByTestId('right-panel')).toBeDefined()
  })

  it('renders with bottom panel', () => {
    render(
      <EditorShell
        canvas={<div />}
        bottomPanel={<div data-testid="bottom-panel" />}
      />,
    )
    expect(screen.getByTestId('bottom-panel')).toBeDefined()
  })

  it('renders default menu and status bars', () => {
    render(<EditorShell canvas={<div />} />)
    expect(screen.getByText('NAVI')).toBeDefined()
  })
})
