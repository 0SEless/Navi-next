"use client"

import { useState, useMemo, useCallback } from "react"
import Image from "next/image"
import { Camera, Search, X, Upload, Maximize2 } from "lucide-react"
import { useGraphStore } from "@/store/graph-store"
import { PanoramaViewer } from "@/components/map/PanoramaViewer"

export default function PanoramaManagement() {
  const graph = useGraphStore((s) => s.graph)
  const updateNode = useGraphStore((s) => s.updateNode)
  const [search, setSearch] = useState("")
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const panoramaNodes = useMemo(() => {
    return graph.nodes.filter((n) => n.hasPanorama).filter((n) =>
      !search || n.label.toLowerCase().includes(search.toLowerCase()) || n.id.toLowerCase().includes(search.toLowerCase())
    )
  }, [graph.nodes, search])

  const unlinkedCount = graph.nodes.filter((n) => !n.hasPanorama).length
  const [viewingPanorama, setViewingPanorama] = useState<string | null>(null)

  const handleUpload = useCallback((nodeId: string, file: File) => {
    setUploadingId(nodeId)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      const node = graph.getNode(nodeId)
      if (node) {
        updateNode(nodeId, { metadata: { ...node.metadata, panoramaUrl: dataUrl } })
      }
      setUploadingId(null)
    }
    reader.readAsDataURL(file)
  }, [updateNode, graph])

  return (
    <div style={{ padding: 24, height: "100%", display: "flex", flexDirection: "column", background: "var(--navi-content)", minHeight: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--navi-text)", margin: 0 }}>Panorama Management</h1>
          <p style={{ fontSize: 12, color: "var(--navi-text-secondary)", margin: "2px 0 0" }}>
            {panoramaNodes.length} linked · {unlinkedCount} unlinked nodes
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 6, padding: "0 10px" }}>
          <Search size={14} color="var(--navi-text-secondary)" />
          <input
            placeholder="Search panoramas by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", padding: "8px 8px", color: "var(--navi-text)", fontSize: 12, outline: "none" }}
          />
          {search && <X size={14} color="var(--navi-text-secondary)" style={{ cursor: "pointer" }} onClick={() => setSearch("")} />}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, alignContent: "start" }}>
        {panoramaNodes.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 48, color: "var(--navi-text-secondary)" }}>
            <Camera size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <p style={{ fontSize: 13 }}>No panoramas found</p>
          </div>
        ) : panoramaNodes.map((node) => {
          const panoramaUrl = node.metadata?.panoramaUrl as string | undefined;
          return (
          <div key={node.id} style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 8, padding: 12 }}>
            {panoramaUrl && (
              <div
                onClick={() => setViewingPanorama(panoramaUrl)}
                style={{ marginBottom: 8, borderRadius: 6, overflow: "hidden", height: 100, background: "var(--navi-content)", cursor: "pointer", position: "relative" }}
                onMouseEnter={(e) => { (e.currentTarget.querySelector('.pano-overlay') as HTMLElement).style.opacity = '1' }}
                onMouseLeave={(e) => { (e.currentTarget.querySelector('.pano-overlay') as HTMLElement).style.opacity = '0' }}
              >
                <Image src={panoramaUrl} alt={node.label} width={300} height={100} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div className="pano-overlay" style={{
                  position: "absolute", inset: 0, background: "rgba(15,23,42,0.4)", opacity: 0,
                  display: "flex", alignItems: "center", justifyContent: "center", transition: "opacity 0.2s",
                }}>
                  <Maximize2 size={20} color="white" />
                </div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 8 }}>
              <Camera size={14} color="var(--navi-primary)" />
              <span style={{ color: "var(--navi-text)", fontSize: 13, fontWeight: 600, marginLeft: 4 }}>{node.label}</span>
              <span style={{ color: "var(--navi-text-secondary)", fontSize: 10, marginLeft: "auto" }}>{node.id}</span>
            </div>
            <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
              <span style={{ background: "var(--navi-content)", borderRadius: 3, padding: "1px 5px", fontSize: 10, color: "var(--navi-text-secondary)" }}>{node.type.replace("_", " ")}</span>
              <span style={{ background: "var(--navi-content)", borderRadius: 3, padding: "1px 5px", fontSize: 10, color: "var(--navi-text-secondary)" }}>Floor {node.floor}</span>
              {node.buildingId && <span style={{ background: "var(--navi-content)", borderRadius: 3, padding: "1px 5px", fontSize: 10, color: "var(--navi-text-secondary)" }}>{node.buildingId}</span>}
            </div>
            <div style={{ color: "var(--navi-text-secondary)", fontSize: 10, marginBottom: 8 }}>
              {node.position.lat.toFixed(5)}, {node.position.lng.toFixed(5)}
            </div>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "5px", background: "var(--navi-primary-light)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 5, cursor: "pointer", fontSize: 10, color: "var(--navi-primary)" }}>
              <Upload size={11} />
              {uploadingId === node.id ? "Uploading..." : panoramaUrl ? "Replace panorama" : "Upload panorama"}
              <input
                type="file"
                accept="image/jpeg,image/png"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(node.id, file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          );
        })}
      </div>
      {viewingPanorama && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.9)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div style={{ width: "100%", maxWidth: 800, height: 450, borderRadius: 12, overflow: "hidden" }}>
            <PanoramaViewer imageUrl={viewingPanorama} />
          </div>
          <button onClick={() => setViewingPanorama(null)}
            style={{ marginTop: 16, padding: "8px 24px", background: "var(--navi-error)", border: "none", borderRadius: 6, color: "white", fontSize: 13, cursor: "pointer" }}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}
