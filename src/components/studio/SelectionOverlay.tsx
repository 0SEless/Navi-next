'use client'

import { useEffect, useRef } from 'react'
import { useSelection } from '@navi/editor'

const SRC_NODES = 's-nodes'
const SRC_NODES_CONNECTION = 's-nodes-connection'
const SRC_POIS = 'navi-pois'

interface SelectionOverlayProps {
  map: maplibregl.Map
}

export function SelectionOverlay({ map }: SelectionOverlayProps) {
  const { lastSelected } = useSelection()
  const lastHighlightedRef = useRef<{ id: string; source: 'node' | 'poi' } | null>(null)

  useEffect(() => {
    const previous = lastHighlightedRef.current
    const current = lastSelected
      ? { id: lastSelected.id, source: lastSelected.type === 'poi' ? 'poi' as const : 'node' as const }
      : null

    if (previous && (!current || previous.id !== current.id || previous.source !== current.source)) {
      try {
        if (previous.source === 'poi') {
          map.setFeatureState({ source: SRC_POIS, id: previous.id }, { selected: false })
        } else {
          map.setFeatureState({ source: SRC_NODES, id: previous.id }, { selected: false })
          map.setFeatureState({ source: SRC_NODES_CONNECTION, id: previous.id }, { selected: false })
        }
      } catch { /* feature may no longer exist */ }
    }

    if (current) {
      try {
        if (current.source === 'poi') {
          map.setFeatureState({ source: SRC_POIS, id: current.id }, { selected: true })
        } else {
          map.setFeatureState({ source: SRC_NODES, id: current.id }, { selected: true })
          map.setFeatureState({ source: SRC_NODES_CONNECTION, id: current.id }, { selected: true })
        }
      } catch { /* feature may no longer exist */ }
    }

    lastHighlightedRef.current = current
  }, [map, lastSelected])

  return null
}
