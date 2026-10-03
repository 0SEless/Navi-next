import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PackageWriter } from '../package-writer'

describe('PackageWriter', () => {
  let outputDir: string
  let writer: PackageWriter

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'pw-test-'))
    writer = new PackageWriter(outputDir)
  })

  afterEach(async () => {
    await writer.destroy()
    rmSync(outputDir, { recursive: true, force: true })
  })

  describe('createStagingDir', () => {
    it('creates a unique staging directory inside outputDir', async () => {
      await writer.createStagingDir()
      expect(writer.stagingDir).not.toBeNull()
      expect(existsSync(writer.stagingDir!)).toBe(true)
      expect(writer.stagingDir!.startsWith(outputDir)).toBe(true)
    })

    it('creates a different directory on each call', async () => {
      await writer.createStagingDir()
      const first = writer.stagingDir

      // new writer for second call
      const writer2 = new PackageWriter(outputDir)
      await writer2.createStagingDir()
      const second = writer2.stagingDir
      await writer2.destroy()

      expect(first).not.toBe(second)
    })

    it('throws if writer has been destroyed', async () => {
      await writer.destroy()
      await expect(writer.createStagingDir()).rejects.toThrow('destroyed')
    })
  })

  describe('writeFile / readFile', () => {
    beforeEach(async () => {
      await writer.createStagingDir()
    })

    it('returns identical bytes via writeFile then readFile', async () => {
      const bytes = new TextEncoder().encode('hello world')
      await writer.writeFile('test.txt', bytes)
      const read = await writer.readFile('test.txt')
      expect(read).toEqual(bytes)
    })

    it('writes binary data correctly', async () => {
      const bytes = new Uint8Array([0x00, 0xFF, 0xAB, 0xCD])
      await writer.writeFile('binary.bin', bytes)
      const read = await writer.readFile('binary.bin')
      expect(read).toEqual(bytes)
    })

    it('writes to nested subdirectories inside staging', async () => {
      const bytes = new TextEncoder().encode('nested content')
      await writer.writeFile('sub/dir/file.txt', bytes)
      const read = await writer.readFile('sub/dir/file.txt')
      expect(read).toEqual(bytes)
    })

    it('writes large content without error', async () => {
      const bytes = new Uint8Array(1024 * 512)
      await writer.writeFile('large.bin', bytes)
      const read = await writer.readFile('large.bin')
      expect(read.byteLength).toBe(1024 * 512)
    })

    it('overwrites existing files', async () => {
      await writer.writeFile('file.txt', new TextEncoder().encode('original'))
      await writer.writeFile('file.txt', new TextEncoder().encode('updated'))
      const read = await writer.readFile('file.txt')
      expect(new TextDecoder().decode(read)).toBe('updated')
    })

    it('readFile throws for non-existent file', async () => {
      await expect(writer.readFile('no-such-file.bin')).rejects.toThrow()
    })

    it('writeFile throws if createStagingDir was not called', async () => {
      const w = new PackageWriter(outputDir)
      await expect(w.writeFile('test.txt', new Uint8Array(0))).rejects.toThrow(
        'Staging directory not created',
      )
    })

    it('readFile throws if createStagingDir was not called', async () => {
      const w = new PackageWriter(outputDir)
      await expect(w.readFile('test.txt')).rejects.toThrow(
        'Staging directory not created',
      )
    })

    it('throws after destroy', async () => {
      await writer.destroy()
      await expect(writer.writeFile('x.txt', new Uint8Array(0))).rejects.toThrow('destroyed')
      await expect(writer.readFile('x.txt')).rejects.toThrow('destroyed')
    })
  })

  describe('destroy', () => {
    it('marks writer as destroyed', async () => {
      expect(writer.destroyed).toBe(false)
      await writer.destroy()
      expect(writer.destroyed).toBe(true)
    })

    it('removes the staging directory', async () => {
      await writer.createStagingDir()
      const dir = writer.stagingDir!
      expect(existsSync(dir)).toBe(true)
      await writer.destroy()
      expect(existsSync(dir)).toBe(false)
    })

    it('removes staging directory after multiple writes', async () => {
      await writer.createStagingDir()
      await writer.writeFile('a.json', new TextEncoder().encode('{"a":1}'))
      await writer.writeFile('b/b.json', new TextEncoder().encode('{"b":2}'))
      await writer.writeFile('c/d/e.json', new TextEncoder().encode('{"c":3}'))
      const dir = writer.stagingDir!
      expect(existsSync(dir)).toBe(true)
      await writer.destroy()
      expect(existsSync(dir)).toBe(false)
    })

    it('is idempotent — calling destroy twice does not error', async () => {
      await writer.createStagingDir()
      await writer.destroy()
      await expect(writer.destroy()).resolves.toBeUndefined()
    })

    it('works when staging dir was never created', async () => {
      await expect(writer.destroy()).resolves.toBeUndefined()
      expect(writer.destroyed).toBe(true)
    })
  })

  it('does not contain JSON serialization or hashing logic', () => {
    const src = PackageWriter.toString()
    expect(src).not.toContain('JSON.stringify')
    expect(src).not.toContain('createHash')
  })
})
