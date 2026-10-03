import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useHydrated } from '../useHydrated'

function Probe() {
  const hydrated = useHydrated()
  return <div>{hydrated ? 'hydrated' : 'not-hydrated'}</div>
}

afterEach(() => {
  cleanup()
})

describe('useHydrated', () => {
  it('SSR render shows the not-hydrated state (effects never run server-side)', () => {
    const html = renderToString(<Probe />)
    expect(html).toBe('<div>not-hydrated</div>')
  })

  it('shows the hydrated state after mount (effect runs)', () => {
    render(<Probe />)
    expect(screen.getByText('hydrated')).toBeDefined()
    expect(screen.queryByText('not-hydrated')).toBeNull()
  })
})
