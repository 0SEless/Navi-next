import { describe, it, expect } from 'vitest'

describe('@navi/editor', () => {
  it('imports from @navi/core', async () => {
    const core = await import('@navi/core')
    expect(core).toBeDefined()
  })
})
