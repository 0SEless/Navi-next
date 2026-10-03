'use client'

import { useState, useRef, useEffect, useCallback, type JSX } from 'react'
import { Search, X } from 'lucide-react'
import { useGraphStore } from '@/store/graph-store'
import type { NavNode } from '@/types/nav-types'

interface SearchBarProps {
  onSelect?: (node: NavNode) => void
  placeholder?: string
  maxResults?: number
}

export function SearchBar({
  onSelect,
  placeholder = 'Search rooms, entrances, walkways...',
  maxResults = 10,
}: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NavNode[]>([])
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const graph = useGraphStore((s) => s.graph)

  const filterNodes = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setResults([])
        setOpen(false)
        return
      }
      const lower = q.toLowerCase()
      const filtered = graph.nodes
        .filter(
          (n) =>
            n.label.toLowerCase().includes(lower) ||
            n.type.toLowerCase().includes(lower) ||
            n.id.toLowerCase().includes(lower)
        )
        .slice(0, maxResults)
      setResults(filtered)
      setOpen(filtered.length > 0)
      setFocusedIndex(-1)
    },
    [graph, maxResults]
  )

  useEffect(() => {
    const timer = setTimeout(() => filterNodes(query), 150)
    return () => clearTimeout(timer)
  }, [query, filterNodes])

  const select = useCallback(
    (node: NavNode) => {
      setQuery(node.label)
      setOpen(false)
      setFocusedIndex(-1)
      onSelect?.(node)
    },
    [onSelect]
  )

  const clear = useCallback(() => {
    setQuery('')
    setResults([])
    setOpen(false)
    setFocusedIndex(-1)
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((i) => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && focusedIndex >= 0) {
        e.preventDefault()
        select(results[focusedIndex])
      } else if (e.key === 'Escape') {
        setOpen(false)
        setFocusedIndex(-1)
      }
    },
    [open, results, focusedIndex, select]
  )

  useEffect(() => {
    const el = listRef.current?.children[focusedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setOpen(true)
          }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder={placeholder}
          className="flex h-10 w-full rounded-md border border-input bg-background px-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Search nodes"
          aria-autocomplete="list"
          aria-controls="search-results-listbox"
          aria-expanded={open}
          role="combobox"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            tabIndex={-1}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          id="search-results-listbox"
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md"
        >
          {results.map((node, i) => (
            <li
              key={node.id}
              role="option"
              aria-selected={i === focusedIndex}
              onMouseDown={() => select(node)}
              onMouseEnter={() => setFocusedIndex(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                i === focusedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'text-popover-foreground'
              } ${i > 0 ? 'border-t border-border/50' : ''}`}
            >
              <span className="flex-1 truncate">
                {highlightMatch(node.label, query)}
              </span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {node.type}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function highlightMatch(text: string, query: string): JSX.Element {
  if (!query.trim()) return <>{text}</>
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent font-medium text-accent-foreground">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
}
