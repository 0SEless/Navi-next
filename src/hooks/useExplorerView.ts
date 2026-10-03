import { useState, useMemo, useCallback, useRef } from 'react'
import type { ExplorerNode, EntityId } from '@navi/editor'

interface UseExplorerViewResult {
  expandedIds: Set<EntityId>
  searchQuery: string
  filteredTree: ExplorerNode[]
  matchCount: number
  toggleExpanded: (id: EntityId) => void
  expandAll: () => void
  collapseAll: () => void
  expandAncestors: (ids: EntityId[]) => void
  setSearchQuery: (query: string) => void
}

function collectIds(nodes: ExplorerNode[]): EntityId[] {
  const ids: EntityId[] = []
  for (const n of nodes) {
    ids.push(n.id)
    if (n.children) ids.push(...collectIds(n.children))
  }
  return ids
}

function findAncestors(nodes: ExplorerNode[], targetId: EntityId, path: EntityId[] = []): EntityId[] | null {
  for (const n of nodes) {
    if (n.id === targetId) return path
    if (n.children) {
      const found = findAncestors(n.children, targetId, [...path, n.id])
      if (found) return found
    }
  }
  return null
}

function nodeMatches(node: ExplorerNode, query: string): boolean {
  const q = query.toLowerCase()
  return node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)
}

/**
 * First pass: mark every node that lies on a path to a match.
 * A node is "in path" if it matches itself or has a descendant that matches.
 * These nodes (and their siblings' context) stay visible in the filtered tree.
 */
function markInPath(nodes: ExplorerNode[], query: string, inPath: Set<EntityId>): boolean {
  const q = query.toLowerCase()
  let subtreeHasMatch = false
  for (const n of nodes) {
    const m = nodeMatches(n, q)
    const childHas = n.children ? markInPath(n.children, query, inPath) : false
    if (m || childHas) {
      inPath.add(n.id)
      subtreeHasMatch = true
    }
  }
  return subtreeHasMatch
}

/**
 * Recursive filter that keeps a node when it is:
 * 1. A matched node (kept with its full children so the branch is visible)
 * 2. An ancestor of a match (kept with its filtered children)
 * 3. A sibling of a match OR of an ancestor (visible as spatial context)
 *
 * `parentInPath` is true when the node's parent sits on a match path, which
 * makes the node itself a visible sibling.
 */
function filterTree(nodes: ExplorerNode[], query: string, inPath: Set<EntityId>, parentInPath: boolean): ExplorerNode[] {
  if (!query.trim()) return nodes
  const q = query.toLowerCase()

  const out: ExplorerNode[] = []
  for (const node of nodes) {
    const match = nodeMatches(node, q)
    const onPath = match || inPath.has(node.id)
    const visible = onPath || parentInPath
    if (!visible) continue

    if (match) {
      // Matched node: keep it with full children (don't prune deeper)
      out.push({ ...node, children: node.children })
    } else {
      const kids = node.children
        ? filterTree(node.children, query, inPath, onPath)
        : undefined
      out.push({ ...node, children: kids && kids.length > 0 ? kids : undefined })
    }
  }
  return out
}

/**
 * First pass: collect ids of every matched node.
 */
function findMatchingIds(nodes: ExplorerNode[], query: string): Set<EntityId> {
  const matched = new Set<EntityId>()
  const q = query.toLowerCase()
  for (const n of nodes) {
    if (nodeMatches(n, q)) matched.add(n.id)
    if (n.children) {
      const childMatches = findMatchingIds(n.children, query)
      childMatches.forEach((id) => matched.add(id))
    }
  }
  return matched
}

function countMatches(nodes: ExplorerNode[], query: string): number {
  if (!query.trim()) return 0
  let count = 0
  for (const n of nodes) {
    if (nodeMatches(n, query)) count++
    if (n.children) count += countMatches(n.children, query)
  }
  return count
}

export function useExplorerView(nodes: ExplorerNode[]): UseExplorerViewResult {
  const [expandedIds, setExpandedIds] = useState<Set<EntityId>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const allIds = useMemo(() => collectIds(nodes), [nodes])

  const matchIds = useMemo(
    () => findMatchingIds(nodes, searchQuery),
    [nodes, searchQuery],
  )

  // Build the set of nodes on a match path, then derive the filtered tree.
  const inPath = useMemo(() => {
    const set = new Set<EntityId>()
    if (searchQuery.trim()) markInPath(nodes, searchQuery, set)
    return set
  }, [nodes, searchQuery])

  const filteredTree = useMemo(
    () => filterTree(nodes, searchQuery, inPath, true),
    [nodes, searchQuery, inPath],
  )

  const matchCount = useMemo(
    () => countMatches(nodes, searchQuery),
    [nodes, searchQuery],
  )

  // Expand ancestors of matched nodes for search
  const prevQueryRef = useRef<string>('')
  if (searchQuery !== prevQueryRef.current) {
    prevQueryRef.current = searchQuery
    if (searchQuery && matchIds.size > 0) {
      const toExpand = new Set<EntityId>()
      for (const id of matchIds) {
        const path = findAncestors(nodes, id)
        if (path) path.forEach((a) => toExpand.add(a))
      }
      if (toExpand.size > 0) {
        setExpandedIds((prev) => {
          const next = new Set(prev)
          toExpand.forEach((id) => next.add(id))
          return next
        })
      }
    }
  }

  const toggleExpanded = useCallback((id: EntityId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => setExpandedIds(new Set(allIds)), [allIds])
  const collapseAll = useCallback(() => setExpandedIds(new Set()), [])

  const expandAncestors = useCallback((ids: EntityId[]) => {
    const ancestors = new Set<EntityId>()
    for (const id of ids) {
      const path = findAncestors(nodes, id)
      if (path) path.forEach((a) => ancestors.add(a))
    }
    setExpandedIds((prev) => {
      const next = new Set(prev)
      ancestors.forEach((a) => next.add(a))
      return next
    })
  }, [nodes])

  return {
    expandedIds,
    searchQuery,
    filteredTree,
    matchCount,
    toggleExpanded,
    expandAll,
    collapseAll,
    expandAncestors,
    setSearchQuery,
  }
}
