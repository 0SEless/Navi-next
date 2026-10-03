import { rename } from 'node:fs/promises'

export class RenameCommitter {
  async commit(stagingDir: string, finalDir: string): Promise<string> {
    await rename(stagingDir, finalDir)
    return finalDir
  }
}
