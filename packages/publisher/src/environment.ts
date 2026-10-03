import { access, mkdir, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface ProbeResult {
  ok: boolean
  error?: string
}

function randomHex(): string {
  return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
}

export class EnvironmentProbe {
  async probeDirectory(path: string): Promise<ProbeResult> {
    try {
      await access(path, constants.F_OK)
    } catch {
      return { ok: false, error: `Output directory does not exist: ${path}` }
    }

    const testFile = join(path, `.navi-probe-${Date.now()}-${randomHex()}`)
    try {
      await writeFile(testFile, new Uint8Array(0))
      await rm(testFile)
    } catch {
      return { ok: false, error: `Output directory is not writable: ${path}` }
    }

    return { ok: true }
  }
}
