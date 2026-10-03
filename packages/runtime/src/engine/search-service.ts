import type { SearchEntry, SearchIndex } from '@navi/core'
import type { LoadedPackage } from '../loader'
import { SearchEngine } from '../search/search-engine'

export type SearchCategory = SearchEntry['type']

export interface SearchResult {
  readonly id: string
  readonly title: string
  readonly category: SearchCategory
  readonly nodeId?: string
  readonly position: SearchEntry['position']
  readonly score?: number
  readonly buildingId?: string
  readonly floor?: number
  readonly floorId?: string
  /** POI-specific category; `category` remains the broad search type. */
  readonly poiCategory?: string
  readonly source?: SearchEntry['source']
  readonly sourceId?: string
}

export class SearchService {
  private engine: SearchEngine | null
  private entries: SearchEntry[]

  constructor(pkg: LoadedPackage) {
    if (pkg.searchIndex) {
      this.engine = new SearchEngine(pkg.searchIndex)
      this.entries = pkg.searchIndex.entries
    } else {
      this.engine = null
      this.entries = []
    }
  }

  search(query: string): SearchResult[] {
    if (!this.engine) return []
    return this.engine.query(query).map(r => this.mapEntry(r.entry, r.score))
  }

  autocomplete(prefix: string): SearchResult[] {
    if (!this.engine) return []
    const lower = prefix.toLowerCase()
    if (!lower) return []
    return this.entries
      .filter(e => e.label.toLowerCase().startsWith(lower))
      .map(e => this.mapEntry(e))
  }

  findById(id: string): SearchResult | undefined {
    const entry = this.entries.find(e => e.id === id)
    return entry ? this.mapEntry(entry) : undefined
  }

  findByCategory(category: SearchCategory): SearchResult[] {
    return this.entries
      .filter(e => e.type === category)
      .map(e => this.mapEntry(e))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  private mapEntry(entry: SearchEntry, score?: number): SearchResult {
    return {
      id: entry.id,
      title: entry.label,
      category: entry.type,
      ...(entry.nodeId !== undefined ? { nodeId: entry.nodeId } : {}),
      position: entry.position,
      score,
      ...(entry.buildingId !== undefined ? { buildingId: entry.buildingId } : {}),
      ...(entry.floor !== undefined ? { floor: entry.floor } : {}),
      ...(entry.floorId !== undefined ? { floorId: entry.floorId } : {}),
      ...(entry.category !== undefined ? { poiCategory: entry.category } : {}),
      ...(entry.source !== undefined ? { source: entry.source } : {}),
      ...(entry.sourceId !== undefined ? { sourceId: entry.sourceId } : {}),
    }
  }
}
