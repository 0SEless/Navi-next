import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RenameCommitter } from '../committer'

describe('RenameCommitter', () => {
  it('renames staging directory to final directory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'commit-test-'))
    const staging = join(tmp, 'staging')
    const final = join(tmp, 'final')

    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'test.txt'), 'hello')

    const committer = new RenameCommitter()
    const result = await committer.commit(staging, final)

    expect(result).toBe(final)
    expect(existsSync(staging)).toBe(false)
    expect(existsSync(final)).toBe(true)
  })

  it('throws if staging directory does not exist', async () => {
    const committer = new RenameCommitter()
    await expect(committer.commit('/does/not/exist', '/some/where')).rejects.toThrow()
  })

  it('throws if final directory already exists', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'commit-exists-'))
    const staging = join(tmp, 'staging')
    const final = join(tmp, 'final')

    await mkdir(staging, { recursive: true })
    await mkdir(final, { recursive: true })

    const committer = new RenameCommitter()
    await expect(committer.commit(staging, final)).rejects.toThrow()
  })

  it('moves files within the staging directory to final', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'commit-files-'))
    const staging = join(tmp, 'staging')
    const final = join(tmp, 'final')

    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'a.json'), '{"a":1}')
    await mkdir(join(staging, 'sub'), { recursive: true })
    await writeFile(join(staging, 'sub', 'b.json'), '{"b":2}')

    const committer = new RenameCommitter()
    await committer.commit(staging, final)

    expect(existsSync(join(final, 'a.json'))).toBe(true)
    expect(existsSync(join(final, 'sub', 'b.json'))).toBe(true)
  })
})
