import type { ProbeResult } from './environment'

export interface Serializer {
  serialize(value: unknown): Uint8Array
  deserialize<T>(bytes: Uint8Array): T
}

export interface ChecksumService {
  hash(bytes: Uint8Array): string
  hashFile(path: string): Promise<string>
}

export interface IEnvironmentProbe {
  probeDirectory(path: string): Promise<ProbeResult>
}

export interface IPackageWriter {
  readonly stagingDir: string | null
  readonly destroyed: boolean
  createStagingDir(): Promise<void>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  destroy(): Promise<void>
}

export interface ICommitter {
  commit(stagingDir: string, finalDir: string): Promise<string>
}
