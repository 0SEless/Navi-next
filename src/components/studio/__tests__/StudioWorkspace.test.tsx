import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@navi/editor', () => ({
  PropertiesPanel: () => <div>PropertiesPanel</div>,
  ProblemsPanel: () => <div>ProblemsPanel</div>,
  useEditor: () => ({
    services: {
      get: vi.fn((key) => {
        if (key === 'publishStore') {
          return {
            getSnapshot: vi.fn(() => ({ publishState: 'idle' })),
            subscribe: vi.fn(() => vi.fn()),
          }
        }
        return null
      })
    }
  }),
  useSelection: () => ({
    lastSelected: null,
    lastSelectedId: null,
    allIds: [],
    select: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
    isSelected: vi.fn(() => false),
    setMode: vi.fn(),
    setHover: vi.fn(),
    clearHover: vi.fn(),
  }),
}))

vi.mock('../StudioCanvas', () => ({
  StudioCanvas: () => <div>StudioCanvas</div>,
}))

vi.mock('../SaveStatus', () => ({
  SaveStatus: () => <div>SaveStatus</div>,
}))

vi.mock('../BuildStatus', () => ({
  BuildStatus: () => <div>BuildStatus</div>,
}))

vi.mock('../ToolDock', () => ({
  ToolDock: () => <div>ToolDock</div>,
}))

vi.mock('../ExplorerPanel', () => ({
  ExplorerPanel: () => <div>ExplorerPanel</div>,
}))

vi.mock('../ConfirmOverlay', () => ({
  ConfirmOverlay: () => <div>ConfirmOverlay</div>,
}))

import { StudioWorkspace } from '../StudioWorkspace'

describe('StudioWorkspace', () => {
  it('renders all child components', () => {
    const { container } = render(<StudioWorkspace mapId="test-campus" />)
    expect(container.textContent).toContain('SaveStatus')
    expect(container.textContent).toContain('BuildStatus')
    expect(container.textContent).toContain('ToolDock')
    expect(container.textContent).toContain('StudioCanvas')
    expect(container.textContent).toContain('ExplorerPanel')
    expect(container.textContent).not.toContain('PropertiesPanel')
    expect(container.textContent).toContain('ConfirmOverlay')
    expect(container.textContent).toContain('Road Recovery')
  })

  it('lets the status header grow to contain multi-row conflict recovery controls', () => {
    const { getByText } = render(<StudioWorkspace mapId="test-campus" />)
    const header = getByText('NAVI STUDIO').parentElement

    expect(header).toHaveStyle({ minHeight: '32px' })
    expect(header).not.toHaveStyle({ height: '32px' })
  })
})
