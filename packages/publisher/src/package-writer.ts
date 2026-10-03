import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'

function randomHex(): string {
  return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
}

export class PackageWriter {
  private _stagingDir: string | null = null
  private _destroyed = false

  constructor(private readonly outputDir: string) {}

  get stagingDir(): string | null {
    return this._stagingDir
  }

  get destroyed(): boolean {
    return this._destroyed
  }

  async createStagingDir(): Promise<void> {
    this.assertNotDestroyed()
    const dir = join(this.outputDir, `.staging-${Date.now()}-${randomHex()}`)
    await mkdir(dir, { recursive: true })
    this._stagingDir = dir
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.assertStagingReady()
    const fullPath = join(this._stagingDir!, path)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, bytes)
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.assertStagingReady()
    const buffer = await readFile(join(this._stagingDir!, path))
    return new Uint8Array(buffer)
  }

  async destroy(): Promise<void> {
    if (this._stagingDir) {
      await rm(this._stagingDir, { recursive: true, force: true })
    }
    this._stagingDir = null
    this._destroyed = true
  }

  private assertNotDestroyed(): void {
    if (this._destroyed) {
      throw new Error('PackageWriter has been destroyed')
    }
  }

  private assertStagingReady(): void {
    this.assertNotDestroyed()
    if (!this._stagingDir) {
      throw new Error('Staging directory not created. Call createStagingDir() first.')
    }
  }
}
