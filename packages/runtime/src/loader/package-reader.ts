import { promises as fs } from 'fs'
import { join } from 'path'

export interface PackageReader {
  readFile(relativePath: string): Promise<string>
  readBytes(relativePath: string): Promise<Uint8Array>
}

export class FilesystemReader implements PackageReader {
  constructor(private readonly basePath: string) {}

  async readFile(relativePath: string): Promise<string> {
    return fs.readFile(join(this.basePath, relativePath), 'utf-8')
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    return fs.readFile(join(this.basePath, relativePath))
  }
}
