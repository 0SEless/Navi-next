import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EnvironmentProbe } from '../environment'

describe('EnvironmentProbe', () => {
  it('passes for an existing writable directory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'env-probe-ok-'))
    try {
      const probe = new EnvironmentProbe()
      const result = await probe.probeDirectory(tmp)
      expect(result.ok).toBe(true)
      expect(result.error).toBeUndefined()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rejects a non-existent directory', async () => {
    const probe = new EnvironmentProbe()
    const result = await probe.probeDirectory(join(tmpdir(), 'does-not-exist-12345'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not exist/)
  })

  it('rejects a file path (not a directory)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'env-probe-file-'))
    const filePath = join(tmp, 'not-a-dir')
    writeFileSync(filePath, '')
    try {
      const probe = new EnvironmentProbe()
      const result = await probe.probeDirectory(filePath)
      expect(result.ok).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('does not contain JSON serialization or hashing logic', () => {
    const src = new EnvironmentProbe().constructor.toString()
    expect(src).not.toContain('JSON.stringify')
    expect(src).not.toContain('createHash')
  })
})
