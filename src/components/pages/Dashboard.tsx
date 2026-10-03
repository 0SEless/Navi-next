import { useState, useMemo } from "react";
import {
  MapPin, Building2, QrCode, Camera, Activity, TrendingUp, AlertTriangle,
  CheckCircle, Clock, ArrowRight, RefreshCw, Route, Database,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import type { ScreenName } from "@/types/screens";
import { useGraphStore } from "@/store/graph-store";
import { useCampusMapStore } from "@/store/campus-map-store";

// Mock data for charts that we can't compute from the graph store yet
// (QR scans, route requests, etc. would come from an analytics API)
const nodeActivityData = [
  { time: "08:00", scans: 12, routes: 8 },
  { time: "09:00", scans: 34, routes: 22 },
  { time: "10:00", scans: 51, routes: 38 },
  { time: "11:00", scans: 43, routes: 31 },
  { time: "12:00", scans: 68, routes: 47 },
  { time: "13:00", scans: 55, routes: 40 },
  { time: "14:00", scans: 72, routes: 55 },
  { time: "15:00", scans: 49, routes: 36 },
  { time: "16:00", scans: 38, routes: 28 },
  { time: "17:00", scans: 22, routes: 15 },
];

const recentActivity = [
  { type: "node", action: "Node N047 added", location: "COE Building, Floor 2", time: "2 min ago", status: "success" },
  { type: "qr", action: "QR checkpoint scanned", location: "Main Plaza (N011)", time: "5 min ago", status: "info" },
  { type: "panorama", action: "Panorama uploaded", location: "Library Entrance (N002)", time: "12 min ago", status: "success" },
  { type: "route", action: "Route validation failed", location: "N031 → N045 (disconnected)", time: "18 min ago", status: "error" },
  { type: "node", action: "Node N023 updated", location: "Admin Building, Floor 1", time: "24 min ago", status: "success" },
  { type: "building", action: "Building metadata edited", location: "Science Laboratory", time: "31 min ago", status: "info" },
  { type: "dataset", action: "Dataset exported", location: "Full GeoJSON backup", time: "1 hr ago", status: "success" },
];

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  trend?: string;
  trendUp?: boolean;
}

function StatCard({ icon: Icon, label, value, sub, color, trend, trendUp }: StatCardProps) {
  return (
    <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, background: `${color}12`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={16} color={color} />
        </div>
        {trend && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: trendUp ? "var(--navi-success)" : "var(--navi-error)", background: trendUp ? "#ECFDF5" : "#FEF2F2", padding: "2px 7px", borderRadius: 10, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
            <TrendingUp size={10} />
            {trend}
          </div>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--navi-text)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--navi-text-secondary)", marginTop: 4, fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--navi-text-secondary)", marginTop: 1, opacity: 0.7 }}>{sub}</div>}
    </div>
  );
}

const activityIcon = (type: string) => {
  switch (type) {
    case "node": return MapPin;
    case "qr": return QrCode;
    case "panorama": return Camera;
    case "route": return Route;
    case "building": return Building2;
    case "dataset": return Database;
    default: return Activity;
  }
};

const activityColor = (status: string) => {
  switch (status) {
    case "success": return "var(--navi-success)";
    case "error": return "var(--navi-error)";
    case "info": return "var(--navi-primary)";
    default: return "var(--navi-text-secondary)";
  }
};

interface DashboardProps {
  onNavigate: (screen: ScreenName) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 1200); };

  // Get real data from graph store
  const graph = useGraphStore((s) => s.graph);
  const campusMaps = useCampusMapStore((s) => s.maps);

  // Compute stats from the graph
  const stats = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];
    const buildings = graph?.buildings ?? [];

    // Count node types
    const nodeTypeCounts: Record<string, number> = {};
    for (const node of nodes) {
      const type = node.type || 'unknown';
      nodeTypeCounts[type] = (nodeTypeCounts[type] || 0) + 1;
    }

    // Count buildings with entrances
    const buildingsWithEntrances = buildings.filter(b => b.entrances && b.entrances.length > 0).length;

    // Count total floors
    const totalFloors = buildings.reduce((sum, b) => sum + (b.floors?.length ?? 0), 0);

    // Count QR checkpoints (nodes with hasQr)
    const qrCount = nodes.filter(n => n.hasQr).length;

    // Count panoramas (nodes with hasPanorama)
    const panoramaCount = nodes.filter(n => n.hasPanorama).length;

    // Compute building usage data from graph
    const buildingUsage = buildings.map(b => ({
      name: b.name || b.id,
      nodes: nodes.filter(n => n.buildingId === b.id).length,
      scans: 0, // Would come from analytics API
    })).filter(b => b.nodes > 0);

    // Compute node type distribution for pie chart
    const nodeTypeData = [
      { name: "Entrance", value: nodeTypeCounts['building_entrance'] ?? nodeTypeCounts['entrance'] ?? 0, color: "var(--navi-primary)" },
      { name: "Intersection", value: nodeTypeCounts['intersection'] ?? 0, color: "#06B6D4" },
      { name: "Staircase", value: nodeTypeCounts['staircase'] ?? nodeTypeCounts['stair'] ?? 0, color: "#059669" },
      { name: "Room", value: nodeTypeCounts['room'] ?? nodeTypeCounts['space'] ?? 0, color: "#D97706" },
      { name: "Elevator", value: nodeTypeCounts['elevator'] ?? nodeTypeCounts['connector_stop'] ?? 0, color: "#7C3AED" },
      { name: "Outdoor", value: nodeTypeCounts['outdoor'] ?? 0, color: "#64748B" },
    ].filter(t => t.value > 0);

    // Check for disconnected nodes
    const adj: Record<string, string[]> = {};
    for (const edge of edges) {
      if (!adj[edge.from]) adj[edge.from] = [];
      if (!adj[edge.to]) adj[edge.to] = [];
      adj[edge.from].push(edge.to);
      adj[edge.to].push(edge.from);
    }
    const disconnectedNodes = nodes.filter(n => !adj[n.id] || adj[n.id].length === 0);

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalBuildings: buildings.length,
      totalFloors,
      qrCount,
      panoramaCount,
      buildingsWithEntrances,
      buildingUsage,
      nodeTypeData,
      disconnectedCount: disconnectedNodes.length,
      disconnectedNodeIds: disconnectedNodes.slice(0, 3).map(n => n.id),
    };
  }, [graph]);

  return (
    <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {/* Page header */}
      <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--navi-text)", margin: 0 }}>Dashboard</h1>
          <p style={{ color: "var(--navi-text-secondary)", fontSize: 12, margin: "2px 0 0" }}>NAVI · {campusMaps?.[0]?.name ?? 'Campus'}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--navi-success)", fontSize: 11, background: "#ECFDF5", padding: "4px 10px", borderRadius: 6 }}>
            <CheckCircle size={11} />
            All Systems Operational
          </div>
          <button onClick={doRefresh} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 6, color: "var(--navi-text-secondary)", fontSize: 11, cursor: "pointer" }}>
            <RefreshCw size={11} style={{ animation: refreshing ? "spin 0.8s linear infinite" : "none" }} />
            Refresh
          </button>
        </div>
      </div>

      <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <StatCard icon={MapPin} label="Navigation Nodes" value={stats.totalNodes} sub={`${stats.totalEdges} edges · ${stats.totalBuildings} buildings`} color="var(--navi-primary)" />
          <StatCard icon={Building2} label="Campus Buildings" value={stats.totalBuildings} sub={`${stats.totalFloors} total floors mapped`} color="#7C3AED" />
          <StatCard icon={QrCode} label="QR Checkpoints" value={stats.qrCount} sub="Active checkpoints" color="#06B6D4" />
          <StatCard icon={Camera} label="Panoramas" value={stats.panoramaCount} sub="Linked to nodes" color="#D97706" />
        </div>

        {/* Charts row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 300px", gap: 12 }}>
          {/* Activity chart */}
          <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: 0 }}>Navigation Activity</h3>
                <p style={{ color: "var(--navi-text-secondary)", fontSize: 11, margin: "2px 0 0" }}>QR scans & route requests today</p>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
                <span style={{ color: "var(--navi-primary)" }}>● QR Scans</span>
                <span style={{ color: "#06B6D4" }}>● Route Requests</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={nodeActivityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--navi-content)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "var(--navi-text-secondary)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--navi-text-secondary)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--navi-sidebar)", border: "none", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--navi-text-sidebar)" }} itemStyle={{ color: "var(--navi-text-sidebar-active)" }} />
                <Line type="monotone" dataKey="scans" stroke="var(--navi-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="routes" stroke="#06B6D4" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Building usage */}
          <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: 0 }}>Building Usage</h3>
              <p style={{ color: "var(--navi-text-secondary)", fontSize: 11, margin: "2px 0 0" }}>Nodes per building</p>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.buildingUsage} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--navi-content)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--navi-text-secondary)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--navi-text-secondary)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--navi-sidebar)", border: "none", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--navi-text-sidebar)" }} itemStyle={{ color: "var(--navi-text-sidebar-active)" }} />
                <Bar dataKey="nodes" fill="var(--navi-primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Node type distribution */}
          <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "16px 18px" }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: "0 0 2px" }}>Node Types</h3>
            <p style={{ color: "var(--navi-text-secondary)", fontSize: 11, margin: "0 0 10px" }}>Distribution by category</p>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <PieChart width={130} height={130}>
                <Pie data={stats.nodeTypeData} cx={65} cy={65} innerRadius={38} outerRadius={60} dataKey="value">
                  {stats.nodeTypeData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
              {stats.nodeTypeData.map((item) => (
                <div key={item.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: item.color }} />
                    <span style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{item.name}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--navi-text)" }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12 }}>
          {/* Recent activity */}
          <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: 0 }}>Recent Activity</h3>
              <button style={{ background: "none", border: "none", color: "var(--navi-primary)", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                View all <ArrowRight size={11} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {recentActivity.map((item, i) => {
                const Icon = activityIcon(item.type);
                const color = activityColor(item.status);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: i < recentActivity.length - 1 ? "1px solid var(--navi-content)" : "none" }}>
                    <div style={{ width: 28, height: 28, background: `${color}12`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={12} color={color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "var(--navi-text)", fontWeight: 500 }}>{item.action}</div>
                      <div style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{item.location}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--navi-text-secondary)", fontSize: 10, flexShrink: 0 }}>
                      <Clock size={9} />
                      {item.time}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Dataset health */}
            <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "14px 16px" }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: "0 0 12px" }}>Dataset Health</h3>
              {[
                { label: "Graph Connectivity", value: stats.totalEdges > 0 ? Math.round((stats.totalEdges / Math.max(stats.totalNodes, 1)) * 100) : 0, color: "var(--navi-success)" },
                { label: "QR Coverage", value: stats.totalNodes > 0 ? Math.round((stats.qrCount / stats.totalNodes) * 100) : 0, color: "var(--navi-primary)" },
                { label: "Panorama Linkage", value: stats.totalNodes > 0 ? Math.round((stats.panoramaCount / stats.totalNodes) * 100) : 0, color: "#D97706" },
                { label: "Building Coverage", value: stats.totalBuildings > 0 ? Math.round((stats.buildingsWithEntrances / stats.totalBuildings) * 100) : 0, color: "#06B6D4" },
              ].map((item) => (
                <div key={item.label} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{item.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--navi-text)" }}>{item.value}%</span>
                  </div>
                  <div style={{ height: 4, background: "var(--navi-content)", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${item.value}%`, background: item.color, borderRadius: 2, transition: "width 0.6s ease" }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div style={{ background: "var(--navi-card)", border: "1px solid var(--navi-border)", borderRadius: 10, padding: "14px 16px" }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)", margin: "0 0 10px" }}>Quick Actions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { label: "Add QR Checkpoint", icon: QrCode, screen: "qr" as ScreenName, color: "#06B6D4" },
                  { label: "Test Route", icon: Route, screen: "routes" as ScreenName, color: "var(--navi-success)" },
                  { label: "Export Dataset", icon: Database, screen: "dataset" as ScreenName, color: "#D97706" },
                ].map(({ label, icon: Icon, screen, color }) => (
                  <button key={label} onClick={() => onNavigate(screen)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--navi-content)", border: "1px solid transparent", borderRadius: 6, cursor: "pointer", color: "var(--navi-text)", fontSize: 12 }}>
                    <div style={{ width: 22, height: 22, background: `${color}12`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={11} color={color} />
                    </div>
                    <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                    <ArrowRight size={10} color="var(--navi-text-secondary)" />
                  </button>
                ))}
              </div>
            </div>

            {/* Alert */}
            {stats.disconnectedCount > 0 && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", display: "flex", gap: 8 }}>
                <AlertTriangle size={13} color="var(--navi-error)" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navi-error)", marginBottom: 2 }}>{stats.disconnectedCount} Disconnected Node{stats.disconnectedCount > 1 ? 's' : ''}</div>
                  <div style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>Node{stats.disconnectedCount > 1 ? 's' : ''} {stats.disconnectedNodeIds.join(', ')} {stats.disconnectedCount > 1 ? 'have' : 'has'} no valid path connections.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
