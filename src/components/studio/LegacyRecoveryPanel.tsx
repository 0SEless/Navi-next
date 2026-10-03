'use client'

import { useMemo, useState } from 'react'
import { useEditor, detectLegacyConnections, type LegacyConnectionCandidate } from '@navi/editor'

/**
 * Fix 2 — controlled legacy connection recovery.
 *
 * Detects roads that look connected under the old implicit behavior but have
 * no authored RoadJunction. Nothing is applied automatically: the admin
 * approves each candidate (Connect) or dismisses it (Keep Separate). Approved
 * candidates create the same canonical authored junctions as new authoring.
 */
export function LegacyRecoveryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { services, document } = useEditor()
  const dispatcher = services.get('dispatcher')
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [scanTick, setScanTick] = useState(0)

  const candidates = useMemo(
    () => (open
      ? detectLegacyConnections(document).filter((c) => !dismissed.has(c.id))
      : []),
    // document is mutated in place by the dispatcher; scanTick forces a rescan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, document, dismissed, scanTick],
  )

  if (!open) return null

  const roadName = (id: string) => document.roads.find((r) => r.id === id)?.name || id

  const apply = (list: LegacyConnectionCandidate[]) => {
    if (!dispatcher || list.length === 0) return
    dispatcher.execute({
      id: 'road.recovery.apply',
      label: 'Apply Road Connections',
      payload: { candidates: list.map((c) => ({ ...c, position: { ...c.position }, roadIds: [...c.roadIds] })) },
    })
    setScanTick((t) => t + 1)
  }

  const keepSeparate = (candidate: LegacyConnectionCandidate) => {
    setDismissed((prev) => new Set(prev).add(candidate.id))
  }

  const highConfidence = candidates.filter((c) => c.confidence === 'high')

  return (
    <div
      role="dialog"
      aria-label="Legacy road connection recovery"
      style={{
        position: 'absolute', top: 12, right: 12, width: 320, maxHeight: '60%', zIndex: 25,
        display: 'flex', flexDirection: 'column', background: 'var(--navi-card)',
        border: '1px solid var(--navi-border)', borderRadius: 8,
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--navi-border)' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--navi-text)' }}>
          ROAD CONNECTION RECOVERY
        </span>
        <button onClick={onClose} aria-label="Close recovery panel" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--navi-text-secondary)', fontSize: 12 }}>✕</button>
      </div>

      <div style={{ padding: '8px 10px', fontSize: 10, color: 'var(--navi-text-secondary)' }}>
        Roads that visually meet but have no authored junction. Approve to create a persistent
        RoadJunction; nothing connects automatically.
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '0 10px 8px' }}>
        <button
          onClick={() => apply(highConfidence)}
          disabled={highConfidence.length === 0}
          style={{
            flex: 1, padding: '6px 8px', borderRadius: 6, border: 'none', fontSize: 10, fontWeight: 700,
            background: highConfidence.length === 0 ? '#374151' : '#10B981',
            color: highConfidence.length === 0 ? '#6B7280' : '#fff',
            cursor: highConfidence.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Approve {highConfidence.length} high-confidence
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid var(--navi-border)' }}>
        {candidates.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--navi-text-secondary)' }}>
            No disconnected legacy contacts detected.
          </div>
        ) : candidates.map((candidate) => (
          <div key={candidate.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: '1px solid var(--navi-border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {roadName(candidate.roadIds[0])} ↔ {roadName(candidate.roadIds[1])}
              </div>
              <div style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>
                {candidate.kind === 'endpoint-endpoint' ? 'Endpoints meet' : 'Endpoint on road'}
                {' · '}{candidate.distanceMeters.toFixed(2)} m
                {' · '}{candidate.confidence === 'high' ? 'high confidence' : 'review'}
              </div>
            </div>
            <button
              onClick={() => apply([candidate])}
              style={{ padding: '4px 8px', borderRadius: 5, border: 'none', background: '#10B981', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
            >
              Connect
            </button>
            <button
              onClick={() => keepSeparate(candidate)}
              style={{ padding: '4px 8px', borderRadius: 5, border: 'none', background: '#475569', color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
            >
              Keep Separate
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
