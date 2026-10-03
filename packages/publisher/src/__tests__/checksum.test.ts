import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hash, hashFile } from '../checksum'

describe('ChecksumService', () => {
  it('produces a SHA-256 hex string of known length', () => {
    const bytes = new TextEncoder().encode('hello')
    const result = hash(bytes)
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[a-f0-9]{64}$/)
  })

  it('matches known SHA-256 value for "hello"', () => {
    const bytes = new TextEncoder().encode('hello')
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(hash(bytes)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('is deterministic — same bytes produce identical hash', () => {
    const bytes = new TextEncoder().encode('deterministic-test')
    const a = hash(bytes)
    const b = hash(bytes)
    expect(a).toBe(b)
  })

  it('produces different hashes for different input', () => {
    const a = hash(new TextEncoder().encode('alpha'))
    const b = hash(new TextEncoder().encode('beta'))
    expect(a).not.toBe(b)
  })

  it('hashes empty bytes', () => {
    const result = hash(new Uint8Array(0))
    expect(result).toHaveLength(64)
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes large input without error', () => {
    const large = new Uint8Array(1024 * 1024)
    const result = hash(large)
    expect(result).toHaveLength(64)
  })

  it('serialize → hash chain: same object → same bytes → same checksum', () => {
    const encoder = new TextEncoder()
    const obj = { campusId: 'campus-1', revision: 'abc' }

    const json = JSON.stringify(obj)
    const bytes = encoder.encode(json)
    const checksum = hash(bytes)

    const json2 = JSON.stringify(obj)
    const bytes2 = encoder.encode(json2)
    const checksum2 = hash(bytes2)

    expect(checksum).toBe(checksum2)
  })

  it('serialize → hash chain: different objects → different checksums', () => {
    const encoder = new TextEncoder()
    const a = hash(encoder.encode(JSON.stringify({ x: 1 })))
    const b = hash(encoder.encode(JSON.stringify({ x: 2 })))
    expect(a).not.toBe(b)
  })
})

describe('hashFile', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'checksum-test-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('hashes a file by path', async () => {
    const filePath = join(tmpDir, 'test.txt')
    writeFileSync(filePath, 'hello', 'utf-8')

    const result = await hashFile(filePath)
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('hashes empty file', async () => {
    const filePath = join(tmpDir, 'empty.txt')
    writeFileSync(filePath, '', 'utf-8')

    const result = await hashFile(filePath)
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('produces same hash as hash() for same content', async () => {
    const filePath = join(tmpDir, 'match.txt')
    const content = 'file content test'
    writeFileSync(filePath, content, 'utf-8')

    const fileHash = await hashFile(filePath)
    const directHash = hash(new TextEncoder().encode(content))

    expect(fileHash).toBe(directHash)
  })
})
