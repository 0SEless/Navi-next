import type { SearchEntry, SearchIndex } from '@navi/core'

export interface SearchResult {
  entry: SearchEntry
  score: number
}

export interface SearchConfig {
  maxResults?: number
  minScore?: number
}

const DEFAULT_CONFIG: Required<SearchConfig> = {
  maxResults: 20,
  minScore: 0,
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[\s,_\-:;,.!?]+/).filter(Boolean)
}

function scoreEntry(entry: SearchEntry, queryTokens: string[]): number {
  let score = 0
  const labelLower = entry.label.toLowerCase()
  const tagLower = [
    ...entry.tags.map(t => t.toLowerCase()),
    ...(entry.category ? [entry.category.toLowerCase()] : []),
  ]

  for (const token of queryTokens) {
    if (labelLower === token) score += 10
    else if (labelLower.startsWith(token)) score += 6
    else if (labelLower.includes(token)) score += 3

    for (const tag of tagLower) {
      if (tag === token) score += 4
      else if (tag.includes(token)) score += 1
    }
  }

  if (score > 0) {
    const typeBoost: Record<string, number> = { building: 3, room: 2, entrance: 1, poi: 1 }
    score += typeBoost[entry.type] ?? 0
  }

  return score
}

export class SearchEngine {
  private entries: SearchEntry[]

  constructor(index: SearchIndex) {
    this.entries = index.entries
  }

  query(text: string, config?: SearchConfig): SearchResult[] {
    const { maxResults, minScore } = { ...DEFAULT_CONFIG, ...config }
    const tokens = tokenize(text)
    if (tokens.length === 0) return []

    const scored = this.entries
      .map(entry => ({ entry, score: scoreEntry(entry, tokens) }))
      .filter(r => r.score > minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)

    return scored
  }
}
