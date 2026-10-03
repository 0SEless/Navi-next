import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function hashFile(path: string): Promise<string> {
  const buffer = await readFile(path)
  return createHash('sha256').update(buffer).digest('hex')
}
