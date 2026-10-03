'use client'

import { useMemo } from 'react'
import { usePublicStore } from '@/store/public-store'

/**
 * Returns a function that resolves a node ID to a human-readable label.
 *
 * Resolution order:
 * 1. Campus bundle's search index (artifacts.searchIndex) — richest labels
 *    (room/building names).
 * 2. Campus graph nodes' own labels ("Route Junction", "Bldg No. 10").
 * 3. Prettified ID fallback ("node-7" → "Node 7") for stale IDs that no
 *    longer exist in the active campus.
 */
export function useNodeLabelResolver() {
  const searchEntries = usePublicStore((s) => s.campus?.searchEntries)
  const nodes = usePublicStore((s) => s.campus?.nodes)

  const byNodeId = useMemo(() => {
    const map = new Map<string, string>()
    // Search index first (rooms, POIs, buildings)
    for (const entry of searchEntries ?? []) {
      if (entry.nodeId && !map.has(entry.nodeId)) {
        map.set(entry.nodeId, entry.label)
      }
    }
    // Graph node labels as second source
    for (const node of nodes ?? []) {
      if (!map.has(node.id) && node.label) {
        map.set(node.id, node.label)
      }
    }
    return map
  }, [searchEntries, nodes])

  return (nodeId: string): string => {
    const label = byNodeId.get(nodeId)
    if (label) return label
    // Prettify fallback: "node-7" → "Node 7", "room-101a" → "Room 101a"
    return nodeId
      .split('-')
      .map((part, i) => (i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join(' ')
  }
}
