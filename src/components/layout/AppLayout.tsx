"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  Camera,
  QrCode,
  Route,
  Database,
  MapPinned,
  ChevronLeft,
  ChevronRight,
  Search,
  LogOut,
  Workflow,
} from "lucide-react";
import type { ScreenName } from "@/types/screens";

interface NavItem {
  id: ScreenName;
  label: string;
  icon: React.ElementType;
  badge?: number;
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },

  { id: "panoramas", label: "Panoramas", icon: Camera, badge: 3 },
  { id: "qr", label: "QR Checkpoints", icon: QrCode },
  { id: "routes", label: "Route Testing", icon: Route },
  { id: "dataset", label: "Dataset Mgmt", icon: Database },
  { id: "capture", label: "NAVI Capture", icon: MapPinned },
  { id: "studio", label: "NAVI Studio", icon: Workflow },
];

interface AppLayoutProps {
  currentScreen: ScreenName;
  onNavigate: (screen: ScreenName) => void;
  children: React.ReactNode;
}

export function AppLayout({ currentScreen, onNavigate, children }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { logout } = useAuth();

  return (
    <div className="navi-admin-shell" data-screen={currentScreen} style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--navi-content)" }}>
      {/* Top Header */}
      <header
        className="navi-admin-header"
        style={{
          background: "var(--navi-card)",
          borderBottom: "1px solid var(--navi-border)",
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
          flexShrink: 0,
        }}
      >
        {/* Brand */}
        <div className="navi-admin-brand" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: sidebarCollapsed ? 48 : 180 }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: "var(--navi-primary)",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Route size={14} color="white" />
          </div>
          {!sidebarCollapsed && (
            <div>
              <span style={{ color: "var(--navi-text)", fontSize: 14, fontWeight: 700, letterSpacing: "0.04em" }}>NAVI</span>
              <span style={{ color: "var(--navi-text-secondary)", fontSize: 10, marginLeft: 6, letterSpacing: "0.06em" }}>ADMIN</span>
            </div>
          )}
        </div>

        {/* Search */}
        <div
          className="navi-admin-search"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            maxWidth: 320,
            background: "var(--navi-content)",
            borderRadius: 6,
            padding: "4px 10px",
          }}
        >
          <Search size={13} color="var(--navi-text-secondary)" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--navi-text)",
              fontSize: 12,
              width: "100%",
            }}
          />
        </div>

        <div className="navi-admin-context" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--navi-success)", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--navi-success)", display: "inline-block" }} />
            Online
          </span>
          <div style={{ width: 1, height: 16, background: "var(--navi-border)" }} />
          <span style={{ color: "var(--navi-text-secondary)", fontSize: 11 }}>ASU Ibajay</span>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Sidebar */}
        <aside
          className="navi-admin-sidebar"
          style={{
            width: sidebarCollapsed ? 48 : 200,
            background: "var(--navi-sidebar)",
            borderRight: "1px solid var(--navi-sidebar-border)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            transition: "width 0.15s ease",
            overflow: "hidden",
          }}
        >
          {/* Collapse toggle */}
          <div style={{ display: "flex", justifyContent: sidebarCollapsed ? "center" : "flex-end", padding: "6px 4px" }}>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--navi-text-sidebar)",
                padding: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: "2px 6px", display: "flex", flexDirection: "column", gap: 1 }}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: sidebarCollapsed ? "7px" : "6px 8px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    background: isActive ? "rgba(37,99,235,0.15)" : "transparent",
                    color: isActive ? "var(--navi-text-sidebar-active)" : "var(--navi-text-sidebar)",
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    fontSize: 12,
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  <Icon size={15} />
                  {!sidebarCollapsed && (
                    <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
                  )}
                  {!sidebarCollapsed && item.badge && (
                    <span style={{ background: "var(--navi-primary)", color: "white", borderRadius: 8, fontSize: 9, padding: "1px 5px", fontWeight: 600 }}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Sign Out */}
          <div style={{ padding: "6px", borderTop: "1px solid var(--navi-sidebar-border)" }}>
            <button
              onClick={logout}
              title={sidebarCollapsed ? "Sign Out" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: sidebarCollapsed ? "7px" : "6px 8px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: "var(--navi-error)",
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                fontSize: 12,
              }}
            >
              <LogOut size={14} />
              {!sidebarCollapsed && <span>Sign Out</span>}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
