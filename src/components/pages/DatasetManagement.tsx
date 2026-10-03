import { useState } from "react";
import {
  Database, Download, Upload, FileJson, CheckCircle, AlertTriangle, XCircle,
  RefreshCw, Clock, Shield, Archive, Play, Trash2, Plus, Copy,
  ChevronDown, ChevronRight, Server, HardDrive, Activity, FileText,
} from "lucide-react";

interface Backup {
  id: string; name: string; type: "auto" | "manual"; size: string; nodes: number; edges: number; created: string; status: "complete" | "in_progress";
}

const BACKUPS: Backup[] = [
  { id: "bk-001", name: "Full Dataset Backup", type: "manual", size: "284 KB", nodes: 100, edges: 148, created: "2025-05-17 08:00", status: "complete" },
  { id: "bk-002", name: "Auto Backup", type: "auto", size: "281 KB", nodes: 98, edges: 145, created: "2025-05-16 23:00", status: "complete" },
  { id: "bk-003", name: "Pre-migration Backup", type: "manual", size: "268 KB", nodes: 92, edges: 138, created: "2025-05-15 14:22", status: "complete" },
  { id: "bk-004", name: "Auto Backup", type: "auto", size: "261 KB", nodes: 89, edges: 135, created: "2025-05-15 23:00", status: "complete" },
  { id: "bk-005", name: "Auto Backup", type: "auto", size: "249 KB", nodes: 84, edges: 128, created: "2025-05-14 23:00", status: "complete" },
];

interface ValidationResult { category: string; status: "pass" | "warn" | "fail"; message: string; count?: number; }

const VALIDATION_RESULTS: ValidationResult[] = [
  { category: "Graph Connectivity", status: "warn", message: "1 node (N031) is disconnected from the main graph", count: 1 },
  { category: "Node Schema", status: "pass", message: "All 100 nodes have valid required fields" },
  { category: "Edge References", status: "pass", message: "All 148 edges reference valid node IDs" },
  { category: "QR Assignments", status: "warn", message: "8 nodes are missing QR checkpoint assignments", count: 8 },
  { category: "Panorama Links", status: "warn", message: "3 panoramas are unlinked to navigation nodes", count: 3 },
  { category: "Floor Coverage", status: "pass", message: "All configured floors have at least 1 navigation node" },
  { category: "Duplicate IDs", status: "pass", message: "No duplicate node or edge IDs found" },
  { category: "Coordinate Bounds", status: "pass", message: "All node coordinates are within canvas bounds" },
  { category: "Building References", status: "pass", message: "All building IDs in nodes reference valid buildings" },
  { category: "Staircase Connectors", status: "fail", message: "COE Floor 2 has no staircase connector to Floor 1" },
];

export function DatasetManagement() {
  const [backups] = useState<Backup[]>(BACKUPS);
  const [activeTab, setActiveTab] = useState<"export" | "import" | "validate" | "backups">("export");
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<"json" | "geojson" | "csv">("json");
  const [expandedJson, setExpandedJson] = useState(false);
  const [importDrag, setImportDrag] = useState(false);

  const runValidation = () => {
    setValidating(true); setValidated(false);
    setTimeout(() => { setValidating(false); setValidated(true); }, 2000);
  };

  const passCount = VALIDATION_RESULTS.filter((r) => r.status === "pass").length;
  const warnCount = VALIDATION_RESULTS.filter((r) => r.status === "warn").length;
  const failCount = VALIDATION_RESULTS.filter((r) => r.status === "fail").length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--navi-text)", margin: 0 }}>Dataset Management</h1>
          <p style={{ color: "var(--navi-text-secondary)", fontSize: 12, margin: "2px 0 0" }}>Import, export, validate, and backup the navigation dataset</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "var(--navi-content)", borderRadius: 6, fontSize: 11, color: "var(--navi-text-secondary)" }}>
            <Server size={11} color="var(--navi-success)" /> 100 nodes · 148 edges
          </div>
          <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "var(--navi-primary)", border: "none", borderRadius: 6, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Archive size={13} /> Create Backup
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ borderBottom: "1px solid var(--navi-border)", padding: "0 24px", display: "flex", gap: 0 }}>
        {([
          ["export", "Export Dataset", Download],
          ["import", "Import Dataset", Upload],
          ["validate", "Validate", CheckCircle],
          ["backups", "Backups", Archive],
        ] as [typeof activeTab, string, React.ElementType][]).map(([tab, label, Icon]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "10px 14px", background: "none", border: "none", borderBottom: activeTab === tab ? "2px solid var(--navi-primary)" : "2px solid transparent", color: activeTab === tab ? "var(--navi-primary)" : "var(--navi-text-secondary)", fontSize: 12, fontWeight: activeTab === tab ? 600 : 400, cursor: "pointer", marginBottom: -1 }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {/* EXPORT TAB */}
        {activeTab === "export" && (
          <div style={{ maxWidth: 800 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "18px" }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: "0 0 14px" }}>Export Format</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { key: "json", label: "Navigation JSON", desc: "Full dataset including nodes, edges, buildings", icon: FileJson, color: "#D97706" },
                    { key: "geojson", label: "GeoJSON", desc: "Geographic format for GIS tools", icon: FileText, color: "var(--navi-success)" },
                    { key: "csv", label: "CSV Export", desc: "Spreadsheet-compatible tables", icon: FileText, color: "var(--navi-primary)" },
                  ].map(({ key, label, desc, icon: Icon, color }) => (
                    <div key={key} onClick={() => setSelectedFormat(key as typeof selectedFormat)} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 8, border: selectedFormat === key ? `1px solid ${color}` : "1px solid var(--navi-border)", background: selectedFormat === key ? `${color}08` : "transparent", cursor: "pointer" }}>
                      <div style={{ width: 32, height: 32, background: `${color}12`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={14} color={color} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navi-text)" }}>{label}</div>
                        <div style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{desc}</div>
                      </div>
                      {selectedFormat === key && <CheckCircle size={14} color={color} style={{ alignSelf: "center" }} />}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "18px" }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: "0 0 14px" }}>Include in Export</h3>
                {["Navigation Nodes (100)", "Path Edges (148)", "Building Metadata (8)", "Floor Layers (23)", "QR Checkpoint Data (47)", "Schema Version Info"].map((label, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 0", cursor: "pointer", fontSize: 12, color: "var(--navi-text)" }}>
                    <div style={{ width: 14, height: 14, background: "var(--navi-primary)", border: "1px solid var(--navi-primary)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="9" height="7" viewBox="0 0 10 8"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
                    </div>
                    {label}
                  </label>
                ))}
                <button style={{ width: "100%", marginTop: 14, padding: "8px", background: "var(--navi-primary)", border: "none", borderRadius: 6, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Download size={12} /> Export as {selectedFormat.toUpperCase()}
                </button>
              </div>
            </div>

            {/* JSON Preview */}
            <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--navi-content)", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setExpandedJson(!expandedJson)}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FileJson size={13} color="#D97706" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navi-text)" }}>JSON Preview</span>
                  <span style={{ fontSize: 10, color: "var(--navi-text-secondary)" }}>navi_dataset_2025-05-17.json</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={{ background: "var(--navi-content)", border: "1px solid var(--navi-border)", borderRadius: 4, padding: "2px 6px", color: "var(--navi-text-secondary)", fontSize: 10, cursor: "pointer" }}>
                    <Copy size={9} style={{ display: "inline" }} /> Copy
                  </button>
                  {expandedJson ? <ChevronDown size={13} color="var(--navi-text-secondary)" /> : <ChevronRight size={13} color="var(--navi-text-secondary)" />}
                </div>
              </div>
              {expandedJson && (
                <pre style={{ background: "var(--navi-sidebar)", color: "var(--navi-text-sidebar)", padding: "16px", fontSize: 11, lineHeight: 1.6, overflowX: "auto", margin: 0, maxHeight: 400 }}>
                  {`{\n  "version": "2.4.1",\n  "campus": "ASU Ibajay",\n  "nodes": [ ... 100 items ],\n  "edges": [ ... 148 items ],\n  "buildings": [ ... 8 items ]\n}`}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* IMPORT TAB */}
        {activeTab === "import" && (
          <div style={{ maxWidth: 700 }}>
            <div onDragOver={(e) => { e.preventDefault(); setImportDrag(true); }} onDragLeave={() => setImportDrag(false)} onDrop={(e) => { e.preventDefault(); setImportDrag(false); }}
              style={{ border: `2px dashed ${importDrag ? "var(--navi-primary)" : "var(--navi-border)"}`, borderRadius: 12, padding: "48px 32px", textAlign: "center", background: importDrag ? "var(--navi-primary-light)" : "var(--navi-card)", cursor: "pointer", marginBottom: 16 }}>
              <Upload size={32} color={importDrag ? "var(--navi-primary)" : "var(--navi-text-secondary)"} style={{ margin: "0 auto 10px" }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navi-text)", marginBottom: 6 }}>Drop dataset file here</div>
              <div style={{ fontSize: 12, color: "var(--navi-text-secondary)", marginBottom: 16 }}>Supports JSON, GeoJSON, and CSV</div>
              <button style={{ padding: "7px 20px", background: "var(--navi-primary)", border: "none", borderRadius: 6, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Browse Files</button>
            </div>

            <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "18px" }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: "0 0 12px" }}>Import Options</h3>
              {[
                { label: "Validate before importing", desc: "Run schema validation before applying changes" },
                { label: "Create backup before import", desc: "Automatically backup current dataset first" },
                { label: "Merge with existing data", desc: "Add imported nodes/edges to existing dataset" },
                { label: "Override node positions", desc: "Update coordinates of existing nodes" },
              ].map(({ label, desc }, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: i < 3 ? "1px solid var(--navi-content)" : "none" }}>
                  <div style={{ width: 16, height: 16, background: "var(--navi-primary)", border: "1px solid var(--navi-primary)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    <svg width="10" height="8" viewBox="0 0 10 8"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--navi-text)" }}>{label}</div>
                    <div style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VALIDATE TAB */}
        {activeTab === "validate" && (
          <div style={{ maxWidth: 760 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--navi-text)", margin: 0 }}>Dataset Validation</h2>
              <button onClick={runValidation} disabled={validating} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", background: validating ? "var(--navi-content)" : "var(--navi-primary)", border: "none", borderRadius: 6, color: validating ? "var(--navi-text-secondary)" : "white", fontSize: 12, fontWeight: 600, cursor: validating ? "default" : "pointer" }}>
                {validating ? <RefreshCw size={12} style={{ animation: "spin 0.8s linear infinite" }} /> : <Play size={12} />}
                {validating ? "Validating..." : "Run Validation"}
              </button>
            </div>

            {validated && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Passed", value: passCount, color: "var(--navi-success)", bg: "#ECFDF5", icon: CheckCircle },
                  { label: "Warnings", value: warnCount, color: "#D97706", bg: "#FFFBEB", icon: AlertTriangle },
                  { label: "Failures", value: failCount, color: "var(--navi-error)", bg: "#FEF2F2", icon: XCircle },
                ].map(({ label, value, color, bg, icon: Icon }) => (
                  <div key={label} style={{ background: bg, border: `1px solid ${color}30`, borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon size={22} color={color} />
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
                      <div style={{ fontSize: 11, color, opacity: 0.8 }}>{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, overflow: "hidden" }}>
              {!validated && !validating && (
                <div style={{ padding: "40px", textAlign: "center", color: "var(--navi-text-secondary)" }}>
                  <Activity size={28} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                  <div style={{ fontSize: 13 }}>Click &ldquo;Run Validation&rdquo; to analyze dataset integrity</div>
                </div>
              )}
              {validating && (
                <div style={{ padding: "40px", textAlign: "center" }}>
                  <div style={{ width: 32, height: 32, border: "2px solid var(--navi-border)", borderTopColor: "var(--navi-primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 14px" }} />
                  <div style={{ fontSize: 13, color: "var(--navi-text-secondary)" }}>Analyzing navigation graph...</div>
                </div>
              )}
              {validated && VALIDATION_RESULTS.map((result, i) => {
                const config = { pass: { color: "var(--navi-success)", bg: "#F0FDF4", icon: CheckCircle }, warn: { color: "#D97706", bg: "#FFFBEB", icon: AlertTriangle }, fail: { color: "var(--navi-error)", bg: "#FEF2F2", icon: XCircle } }[result.status];
                const Icon = config.icon;
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "10px 16px", borderBottom: i < VALIDATION_RESULTS.length - 1 ? "1px solid var(--navi-content)" : "none", background: result.status !== "pass" ? config.bg : "transparent" }}>
                    <Icon size={14} color={config.color} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navi-text)" }}>{result.category}</div>
                      <div style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{result.message}</div>
                    </div>
                    {result.count !== undefined && <div style={{ fontSize: 12, fontWeight: 700, color: config.color, flexShrink: 0 }}>{result.count}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* BACKUPS TAB */}
        {activeTab === "backups" && (
          <div style={{ maxWidth: 800 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
              {[
                { label: "Total Backups", value: backups.length, icon: HardDrive, color: "var(--navi-primary)" },
                { label: "Total Size", value: "1.34 MB", icon: Database, color: "#7C3AED" },
                { label: "Last Backup", value: "Today 08:00", icon: Clock, color: "var(--navi-success)" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, background: `${color}12`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={16} color={color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--navi-text)" }}>{value}</div>
                    <div style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{label}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "16px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Shield size={14} color="var(--navi-primary)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)" }}>Automatic Backup Schedule</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--navi-success)" }}>Enabled</span>
                  <div style={{ width: 34, height: 18, background: "var(--navi-success)", borderRadius: 9, position: "relative" }}>
                    <div style={{ position: "absolute", right: 2, top: 2, width: 14, height: 14, background: "white", borderRadius: "50%" }} />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {[
                  { label: "Frequency", value: "Daily at 23:00" },
                  { label: "Retention", value: "30 days" },
                  { label: "Location", value: "Server local" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: "var(--navi-content)", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: "var(--navi-text-secondary)", fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "var(--navi-text)", fontWeight: 500, marginTop: 1 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--navi-content)", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)" }}>Backup History</span>
                <button style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "var(--navi-primary)", border: "none", borderRadius: 5, color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  <Plus size={11} /> Create Backup
                </button>
              </div>
              {backups.map((bk, i) => (
                <div key={bk.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < backups.length - 1 ? "1px solid var(--navi-content)" : "none" }}>
                  <div style={{ width: 34, height: 34, background: bk.type === "manual" ? "var(--navi-primary-light)" : "var(--navi-content)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Archive size={14} color={bk.type === "manual" ? "var(--navi-primary)" : "var(--navi-text-secondary)"} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navi-text)" }}>{bk.name}</div>
                    <div style={{ fontSize: 10, color: "var(--navi-text-secondary)" }}>
                      <Clock size={8} style={{ display: "inline", marginRight: 2 }} />
                      {bk.created} · {bk.size}
                    </div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 600, color: bk.type === "manual" ? "var(--navi-primary)" : "var(--navi-text-secondary)", background: bk.type === "manual" ? "var(--navi-primary-light)" : "var(--navi-content)", padding: "2px 6px", borderRadius: 6 }}>
                    {bk.type === "manual" ? "Manual" : "Auto"}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button style={{ padding: "4px 8px", background: "var(--navi-content)", border: "1px solid var(--navi-border)", borderRadius: 4, color: "var(--navi-text-secondary)", fontSize: 10, cursor: "pointer" }}><Download size={10} /></button>
                    <button style={{ padding: "4px 8px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 4, color: "var(--navi-success)", fontSize: 10, cursor: "pointer" }}><RefreshCw size={10} /></button>
                    <button style={{ padding: "4px 8px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, color: "var(--navi-error)", fontSize: 10, cursor: "pointer" }}><Trash2 size={10} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
