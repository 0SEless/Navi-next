import { describe, expect, it, vi } from 'vitest'
import { persistStudioGraph } from '../studio-persistence'

describe('Studio persistence adapter', () => {
  it('does not resolve or refresh the editor until graph-store save resolves', async () => {
    let releaseGraphSave!: () => void
    const graphSave = new Promise<void>((resolve) => {
      releaseGraphSave = resolve
    })
    const syncDocument = vi.fn()
    const bumpRenderVersion = vi.fn()

    let settled = false
    const savePromise = persistStudioGraph({
      syncDocument,
      saveGraph: () => graphSave,
      bumpRenderVersion,
    }).then(() => {
      settled = true
    })

    expect(syncDocument).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    expect(bumpRenderVersion).not.toHaveBeenCalled()

    releaseGraphSave()
    await savePromise

    expect(settled).toBe(true)
    expect(bumpRenderVersion).toHaveBeenCalledTimes(1)
  })

  it('propagates a graph-store conflict without claiming persistence success', async () => {
    const conflict = new Error('Save conflict — local changes preserved')
    const bumpRenderVersion = vi.fn()

    await expect(persistStudioGraph({
      syncDocument: vi.fn(),
      saveGraph: vi.fn().mockRejectedValue(conflict),
      bumpRenderVersion,
    })).rejects.toThrow(conflict.message)

    expect(bumpRenderVersion).not.toHaveBeenCalled()
  })
})
