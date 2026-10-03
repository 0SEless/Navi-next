import { describe, it, expect } from 'vitest'
import { Sha256Verifier } from '../checksum-verifier'

const encoder = new TextEncoder()
const verifier = new Sha256Verifier()

describe('Sha256Verifier', () => {
  it('matches known SHA-256 value for "hello"', () => {
    const result = verifier.hash(encoder.encode('hello'))
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('is deterministic â€” same bytes produce identical hash', () => {
    const bytes = encoder.encode('deterministic-test')
    expect(verifier.hash(bytes)).toBe(verifier.hash(bytes))
  })

  it('produces different hashes for different input', () => {
    const a = verifier.hash(encoder.encode('alpha'))
    const b = verifier.hash(encoder.encode('beta'))
    expect(a).not.toBe(b)
  })

  it('hashes empty bytes', () => {
    const result = verifier.hash(new Uint8Array(0))
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes large input without error', () => {
    const large = new Uint8Array(1024 * 1024)
    const result = verifier.hash(large)
    expect(result).toHaveLength(64)
  })

  it('verify returns true for matching checksum', () => {
    const bytes = encoder.encode('hello')
    const checksum = verifier.hash(bytes)
    expect(verifier.verify(bytes, checksum)).toBe(true)
  })

  it('verify returns false for mismatched checksum', () => {
    const bytes = encoder.encode('hello')
    expect(verifier.verify(bytes, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false)
  })

  it('verify returns false for empty expected', () => {
    const bytes = encoder.encode('hello')
    expect(verifier.verify(bytes, '')).toBe(false)
  })
})
