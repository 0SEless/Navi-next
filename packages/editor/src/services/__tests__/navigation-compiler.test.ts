import { describe, it, expect, vi } from 'vitest'
import { NavigationCompiler } from '../navigation-compiler'
import type { CompilerAdapter, CompileResult } from '../navigation-compiler'

describe('NavigationCompiler', () => {
  it('delegates compile to adapter', async () => {
    const adapter: CompilerAdapter = {
      compile: vi.fn().mockResolvedValue({
        status: 'success',
        timestamp: 100,
        artifacts: {
          navigationGraph: { nodes: [] },
          searchIndex: null,
          poiData: null,
          buildingIndex: null,
        },
      }),
    }

    const compiler = new NavigationCompiler(adapter)
    const doc = { metadata: { campusId: 'test', name: 'test' } } as any
    const result = await compiler.compile(doc)

    expect(result.status).toBe('success')
    expect(adapter.compile).toHaveBeenCalledWith(doc)
  })

  it('concurrent calls return in-flight promise', async () => {
    let callCount = 0
    const adapter: CompilerAdapter = {
      compile: vi.fn().mockImplementation(async () => {
        callCount++
        await new Promise(r => setTimeout(r, 50))
        return { status: 'success', timestamp: 100 } as CompileResult
      }),
    }

    const compiler = new NavigationCompiler(adapter)
    const doc = { metadata: { campusId: 'test', name: 'test' } } as any

    const [r1, r2] = await Promise.all([compiler.compile(doc), compiler.compile(doc)])
    expect(r1.status).toBe('success')
    expect(r2.status).toBe('success')
    expect(callCount).toBe(1)  // only one actual call
  })

  it('resets concurrent guard after completion', async () => {
    const adapter: CompilerAdapter = {
      compile: vi.fn().mockResolvedValue({ status: 'success', timestamp: 100 } as CompileResult),
    }

    const compiler = new NavigationCompiler(adapter)
    const doc = { metadata: { campusId: 'test', name: 'test' } } as any

    await compiler.compile(doc)
    await compiler.compile(doc)  // second call should work
    expect(adapter.compile).toHaveBeenCalledTimes(2)
  })

  it('resets concurrent guard after error', async () => {
    const adapter: CompilerAdapter = {
      compile: vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ status: 'success', timestamp: 100 } as CompileResult),
    }

    const compiler = new NavigationCompiler(adapter)
    const doc = { metadata: { campusId: 'test', name: 'test' } } as any

    await expect(compiler.compile(doc)).rejects.toThrow('fail')
    const result = await compiler.compile(doc)
    expect(result.status).toBe('success')
  })
})
