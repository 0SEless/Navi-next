'use client'

import { useState } from 'react'

interface ParsedBuilding {
  id: string
  name: string
  footprint: { lat: number; lng: number }[]
  height: number
  color: string
  center: { lat: number; lng: number }
  levels?: number
  rawTags: Record<string, string>
}

interface Result {
  query: Record<string, unknown>
  raw: { elements: number; remark: string | null }
  buildings: ParsedBuilding[]
  count: number
}

export default function OsmImportSandbox() {
  const [lat, setLat] = useState('11.8195')
  const [lng, setLng] = useState('122.0922')
  const [radius, setRadius] = useState('0.008')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const [boundaryText, setBoundaryText] = useState('')
  const [postResult, setPostResult] = useState<Result | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [postLoading, setPostLoading] = useState(false)

  const genBoundaryFromBbox = () => {
    const r = parseFloat(radius)
    const la = parseFloat(lat)
    const ln = parseFloat(lng)
    const pts = [
      { lat: la - r, lng: ln - r },
      { lat: la + r, lng: ln - r },
      { lat: la + r, lng: ln + r },
      { lat: la - r, lng: ln + r },
    ]
    setBoundaryText(JSON.stringify(pts, null, 2))
  }

  const fetchOSM = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setSelectedIdx(null)
    try {
      const params = new URLSearchParams({ lat, lng, radius })
      const res = await fetch(`/api/osm-buildings?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResult(data as Result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const fetchOSMPost = async () => {
    setPostLoading(true)
    setPostError(null)
    setPostResult(null)
    try {
      const boundary = JSON.parse(boundaryText)
      if (!Array.isArray(boundary) || boundary.length < 3) throw new Error('Boundary must be an array of {lat,lng} with 3+ points')
      const res = await fetch('/api/osm-buildings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boundary }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setPostResult(data as Result)
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setPostLoading(false)
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>OSM Building Import — Sandbox</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        Query Overpass API for building footprints around a center point.
        Parsed buildings match the app&apos;s <code>Building</code> type.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Center Lat
          <input value={lat} onChange={(e) => setLat(e.target.value)}
            style={{ width: 100, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Center Lng
          <input value={lng} onChange={(e) => setLng(e.target.value)}
            style={{ width: 100, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          Radius (degrees)
          <input value={radius} onChange={(e) => setRadius(e.target.value)}
            style={{ width: 80, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} />
        </label>
        <button onClick={fetchOSM} disabled={loading}
          style={{ padding: '6px 16px', background: loading ? '#ccc' : '#1C6BEB', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
          {loading ? 'Fetching...' : 'Fetch from OSM'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, color: '#DC2626', marginBottom: 16 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6 }}>
              <strong>{result.count}</strong> buildings parsed
            </div>
            <div style={{ padding: '8px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6 }}>
              BBox: {typeof result.query.bbox === 'string' ? result.query.bbox : JSON.stringify(result.query.bbox)}
            </div>
            <div style={{ padding: '8px 12px', background: '#F5F5F5', border: '1px solid #D4D4D4', borderRadius: 6 }}>
              Raw elements: {result.raw.elements}
              {result.raw.remark && <span style={{ color: '#F59E0B' }}> — {result.raw.remark}</span>}
            </div>
          </div>

          <div style={{ border: '1px solid #D4D4D4', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 60px 80px 120px 100px', gap: 0, background: '#F5F5F5', borderBottom: '1px solid #D4D4D4', fontWeight: 600, padding: '6px 8px' }}>
              <span>#</span><span>Name</span><span>Height</span><span>Levels</span><span>Footprint pts</span><span>Color</span>
            </div>
            {result.buildings.map((b, i) => (
              <div key={b.id}>
                <div
                  onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                  style={{
                    display: 'grid', gridTemplateColumns: '30px 1fr 60px 80px 120px 100px',
                    padding: '6px 8px', borderBottom: '1px solid #E5E5E5',
                    background: selectedIdx === i ? '#EFF6FF' : undefined,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: '#999' }}>{i + 1}</span>
                  <span>{b.name}</span>
                  <span>{b.height.toFixed(1)}m</span>
                  <span>{b.levels ?? '?'}</span>
                  <span>{b.footprint.length} points</span>
                  <span>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: b.color, verticalAlign: 'middle', marginRight: 4 }} />
                    {b.color}
                  </span>
                </div>
                {selectedIdx === i && (
                  <div style={{ padding: '8px 12px', background: '#FAFAFA', borderBottom: '1px solid #E5E5E5', fontSize: 11 }}>
                    <div style={{ marginBottom: 4 }}><strong>ID:</strong> {b.id}</div>
                    <div style={{ marginBottom: 4 }}><strong>Center:</strong> {b.center.lat.toFixed(6)}, {b.center.lng.toFixed(6)}</div>
                    <div style={{ marginBottom: 4 }}>
                      <strong>Footprint:</strong>{' '}
                      <span style={{ color: '#666' }}>
                        [{b.footprint.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(' ')}]
                      </span>
                    </div>
                    <details>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Raw Tags ({Object.keys(b.rawTags).length})</summary>
                      <pre style={{ marginTop: 4, padding: 8, background: '#1a1a2e', color: '#E2E8F0', borderRadius: 4, overflow: 'auto', fontSize: 10, maxHeight: 200 }}>
                        {JSON.stringify(b.rawTags, null, 2)}
                      </pre>
                    </details>
                    {b.footprint.length >= 3 && (
                      <div style={{ marginTop: 4 }}>
                        <strong>Polygon valid:</strong>{' '}
                        <span style={{ color: '#10B981' }}>
                          ✓ {b.footprint.length} points, closed={b.footprint[0].lat === b.footprint[b.footprint.length-1].lat && b.footprint[0].lng === b.footprint[b.footprint.length-1].lng ? 'yes' : 'no'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>Raw Overpass Response</summary>
            <pre style={{ padding: 12, background: '#1a1a2e', color: '#E2E8F0', borderRadius: 6, overflow: 'auto', fontSize: 10, maxHeight: 400 }}>
              {JSON.stringify({ query: result.query, raw: result.raw, count: result.count }, null, 2)}
            </pre>
          </details>
        </>
      )}

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '2px solid #E5E5E5' }} />
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>POST — Boundary Polygon Import</h2>
      <p style={{ color: '#666', marginBottom: 12, fontSize: 11 }}>
        Import buildings inside a boundary polygon. The boundary is sent to <code>POST /api/osm-buildings</code>.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button onClick={genBoundaryFromBbox}
          style={{ padding: '4px 12px', background: '#F5F5F5', border: '1px solid #D4D4D4', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
          Generate boundary from bbox
        </button>
        <button onClick={fetchOSMPost} disabled={postLoading || !boundaryText}
          style={{ padding: '6px 16px', background: postLoading ? '#ccc' : '#8B5CF6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
          {postLoading ? 'Importing...' : 'Test POST (boundary)'}
        </button>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 }}>
        Boundary polygon (JSON array of {"{lat, lng}"})
        <textarea value={boundaryText} onChange={(e) => setBoundaryText(e.target.value)} rows={4}
          style={{ padding: 6, border: '1px solid #ccc', borderRadius: 4, fontSize: 11, fontFamily: 'monospace' }} />
      </label>

      {postError && (
        <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, color: '#DC2626', marginBottom: 16, fontSize: 11 }}>
          <strong>Error:</strong> {postError}
        </div>
      )}

      {postResult && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 6 }}>
              <strong>{postResult.count}</strong> buildings parsed
            </div>
            <div style={{ padding: '8px 12px', background: '#F5F5F5', border: '1px solid #D4D4D4', borderRadius: 6 }}>
              Raw elements: {postResult.raw.elements}
              {postResult.raw.remark && <span style={{ color: '#F59E0B' }}> — {postResult.raw.remark}</span>}
            </div>
          </div>

          <div style={{ border: '1px solid #D4D4D4', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 60px 80px 120px 100px', gap: 0, background: '#F5F5F5', borderBottom: '1px solid #D4D4D4', fontWeight: 600, padding: '6px 8px' }}>
              <span>#</span><span>Name</span><span>Height</span><span>Levels</span><span>Footprint pts</span><span>Color</span>
            </div>
            {postResult.buildings.map((b, i) => (
              <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 60px 80px 120px 100px', padding: '6px 8px', borderBottom: '1px solid #E5E5E5' }}>
                <span style={{ color: '#999' }}>{i + 1}</span>
                <span>{b.name}</span>
                <span>{b.height.toFixed(1)}m</span>
                <span>{b.levels ?? '?'}</span>
                <span>{b.footprint.length} points</span>
                <span>
                  <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: b.color, verticalAlign: 'middle', marginRight: 4 }} />
                  {b.color}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 24, padding: 12, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 11 }}>
        <strong>⚠ Edge cases to test:</strong>
        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
          <li>Empty area (ocean) → 0 buildings</li>
          <li>Very dense area (CBD) → many buildings, check response time</li>
          <li>Building with hole (courtyard) → geometry may self-intersect</li>
          <li>Missing tags → all fallbacks should work</li>
          <li>Very large radius → Overpass timeout (25s)</li>
        </ul>
      </div>
    </div>
  )
}
