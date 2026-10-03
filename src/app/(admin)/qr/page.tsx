"use client"

import { useState, useMemo, useCallback } from "react"
import { QrCode, Search, X, Check, ScanLine } from "lucide-react"
import { useGraphStore } from "@/store/graph-store"
import { QRScanner } from "@/components/map/QRScanner"

export default function QRManagement() {
  const graph = useGraphStore((s) => s.graph)
  const [search, setSearch] = useState("")
  const [scanning, setScanning] = useState(false)
  const [scannedNode, setScannedNode] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const handleQrScan = useCallback((nodeId: string) => {
    setScanning(false)
    setScanError(null)
    setScannedNode(nodeId)
    setTimeout(() => setScannedNode(null), 5000)
  }, [])

  const qrNodes = useMemo(() => {
    return graph.nodes.filter((n) => n.hasQr).filter((n) =>
      !search || n.label.toLowerCase().includes(search.toLowerCase()) || n.id.toLowerCase().includes(search.toLowerCase())
    )
  }, [graph.nodes, search])

  const activeCount = qrNodes.length
  const totalNodes = graph.nodes.length

  return (
    <div style={{ padding: 24, background: "var(--navi-content)", minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--navi-text)", margin: 0 }}>QR Checkpoints</h1>
          <p style={{ fontSize: 12, color: "var(--navi-text-secondary)", margin: "2px 0 0" }}>
            {activeCount} active QR codes · {totalNodes} total nodes
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 6, padding: "0 10px" }}>
          <Search size={14} color="var(--navi-text-secondary)" />
          <input
            placeholder="Search QR checkpoints by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", padding: "8px 8px", color: "var(--navi-text)", fontSize: 12, outline: "none" }}
          />
          {search && <X size={14} color="var(--navi-text-secondary)" style={{ cursor: "pointer" }} onClick={() => setSearch("")} />}
        </div>
        <button onClick={() => setScanning(true)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "var(--navi-primary)", border: "none", borderRadius: 6, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <ScanLine size={14} /> Scan QR
        </button>
      </div>
      {scannedNode && (
        <div style={{ marginBottom: 12, padding: "8px 14px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <Check size={14} color="var(--navi-success)" />
          <span style={{ color: "var(--navi-success)", fontSize: 12, fontWeight: 600 }}>Scanned: {scannedNode}</span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--navi-border)" }}>
              <th style={{ textAlign: "left", padding: "8px 10px", color: "var(--navi-text-secondary)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>NODE</th>
              <th style={{ textAlign: "left", padding: "8px 10px", color: "var(--navi-text-secondary)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>NAME</th>
              <th style={{ textAlign: "left", padding: "8px 10px", color: "var(--navi-text-secondary)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>TYPE</th>
              <th style={{ textAlign: "left", padding: "8px 10px", color: "var(--navi-text-secondary)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>FLOOR</th>
              <th style={{ textAlign: "left", padding: "8px 10px", color: "var(--navi-text-secondary)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>BUILDING</th>
              <th style={{ textAlign: "left", padding: "8px 10px", color: "var(--navi-text-secondary)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {qrNodes.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 48, color: "var(--navi-text-secondary)" }}>
                  <QrCode size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                  <p style={{ fontSize: 13 }}>No QR checkpoints found</p>
                </td>
              </tr>
            ) : qrNodes.map((node) => (
              <tr key={node.id} style={{ borderBottom: "1px solid var(--navi-border)" }}>
                <td style={{ padding: "10px", color: "var(--navi-primary)", fontSize: 12, fontWeight: 600 }}>{node.id}</td>
                <td style={{ padding: "10px", color: "var(--navi-text)", fontSize: 12 }}>{node.label}</td>
                <td style={{ padding: "10px" }}>
                  <span style={{ background: "var(--navi-content)", borderRadius: 3, padding: "2px 6px", fontSize: 10, color: "var(--navi-text-secondary)" }}>{node.type.replace("_", " ")}</span>
                </td>
                <td style={{ padding: "10px", color: "var(--navi-text-secondary)", fontSize: 11 }}>{node.floor === 0 ? "G" : node.floor}</td>
                <td style={{ padding: "10px", color: "var(--navi-text-secondary)", fontSize: 11 }}>{node.buildingId ?? "-"}</td>
                <td style={{ padding: "10px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "rgba(16,185,129,0.1)", color: "var(--navi-success)", borderRadius: 3, padding: "2px 6px", fontSize: 10, fontWeight: 500 }}>
                    <Check size={10} />
                    Active
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scanning && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.9)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 300, height: 300, borderRadius: 12, overflow: "hidden" }}>
            <QRScanner onScan={handleQrScan} onError={(err) => setScanError(err)} />
          </div>
          {scanError && <p style={{ color: "var(--navi-error)", fontSize: 12, marginTop: 8 }}>{scanError}</p>}
          <button onClick={() => { setScanning(false); setScanError(null) }}
            style={{ marginTop: 16, padding: "8px 24px", background: "var(--navi-error)", border: "none", borderRadius: 6, color: "white", fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
