import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(resolve(process.cwd(), 'src/app/demo/navigate/page.tsx'), 'utf8')
const runtimeMapShellSource = readFileSync(
  resolve(process.cwd(), 'src/app/components/RuntimeMapShell.tsx'),
  'utf8'
)

describe('demo navigate client boundary', () => {
  it('imports the browser-safe runtime engine entrypoint', () => {
    expect(pageSource).toMatch(
      /import\s+\{\s*RuntimeEngine\s*\}\s+from\s+['"]@navi\/runtime\/engine['"]/
    )
    expect(pageSource).not.toMatch(
      /import\s+\{\s*RuntimeEngine\s*\}\s+from\s+['"]@navi\/runtime['"]/
    )
  })

  it('keeps the public runtime map on the browser-safe engine entrypoint', () => {
    expect(runtimeMapShellSource).toMatch(
      /import\s+\{\s*RuntimeEngine\s*\}\s+from\s+['"]@navi\/runtime\/engine['"]/
    )
    expect(runtimeMapShellSource).not.toMatch(
      /import\s+\{\s*RuntimeEngine\s*\}\s+from\s+['"]@navi\/runtime['"]/
    )
  })

  it('exposes RuntimeEngine without loading the filesystem loader', async () => {
    const engine = await import('@navi/runtime/engine')

    expect(typeof engine.RuntimeEngine).toBe('function')
  })
})
