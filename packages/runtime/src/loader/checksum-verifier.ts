import { createHash } from 'node:crypto'

export interface ChecksumVerifier {
  hash(bytes: Uint8Array): string
  verify(bytes: Uint8Array, expected: string): boolean
}

export class Sha256Verifier implements ChecksumVerifier {
  hash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
  }

  verify(bytes: Uint8Array, expected: string): boolean {
    return this.hash(bytes) === expected
  }
}
