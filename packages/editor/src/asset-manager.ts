export interface AssetEntry {
  id: string
  fileName: string
  mimeType: string
  size: number
  contentHash: string
  storagePath: string
  importedAt: string
}

function generateId(): string {
  return `asset-${crypto.randomUUID().slice(0, 8)}`
}

export class AssetManager {
  private assets = new Map<string, AssetEntry>()
  private references = new Map<string, Set<string>>()

  import(path: string): AssetEntry {
    const id = generateId()
    const now = new Date().toISOString()
    const entry: AssetEntry = {
      id,
      fileName: path.split(/[/\\]/).pop() ?? path,
      mimeType: 'application/octet-stream',
      size: 0,
      contentHash: id,
      storagePath: path,
      importedAt: now,
    }
    this.assets.set(id, entry)
    return entry
  }

  get(id: string): AssetEntry | undefined {
    return this.assets.get(id)
  }

  remove(id: string): boolean {
    const refs = this.references.get(id)
    if (refs && refs.size > 0) {
      return false
    }
    this.references.delete(id)
    return this.assets.delete(id)
  }

  has(id: string): boolean {
    return this.assets.has(id)
  }

  referencesOf(id: string): string[] {
    const refs = this.references.get(id)
    return refs ? [...refs] : []
  }

  list(): AssetEntry[] {
    return [...this.assets.values()]
  }

  cleanup(): string[] {
    const removed: string[] = []
    for (const [id, entry] of this.assets) {
      const refs = this.references.get(id)
      if (!refs || refs.size === 0) {
        this.assets.delete(id)
        this.references.delete(id)
        removed.push(id)
      }
    }
    return removed
  }

  addReference(assetId: string, entityId: string): void {
    if (!this.assets.has(assetId)) return
    if (!this.references.has(assetId)) {
      this.references.set(assetId, new Set())
    }
    this.references.get(assetId)!.add(entityId)
  }

  removeReference(assetId: string, entityId: string): void {
    this.references.get(assetId)?.delete(entityId)
  }
}
