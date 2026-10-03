"use client";

import { useState } from "react";
import { Route } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { MOCK_USERS, isMockAuthEnabled } from "@/lib/mock-auth";

export function LoginScreen() {
  const { signInWithGoogle, mockLogin } = useAuth();
  const [mockEnabled] = useState(isMockAuthEnabled);

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      display: "flex",
      background: "var(--navi-content)",
    }}>
      {/* Left - Brand panel */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 8%",
        maxWidth: 520,
      }}>
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{
              width: 40,
              height: 40,
              background: "var(--navi-primary)",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Route size={20} color="white" />
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--navi-text)", letterSpacing: "0.04em" }}>NAVI</div>
              <div style={{ fontSize: 11, color: "var(--navi-text-secondary)", letterSpacing: "0.1em" }}>CAMPUS NAVIGATION</div>
            </div>
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--navi-text)", lineHeight: 1.2, margin: 0 }}>
            Admin Console
          </h1>
          <p style={{ color: "var(--navi-text-secondary)", fontSize: 14, lineHeight: 1.6, marginTop: 12, maxWidth: 360 }}>
            Manage navigation nodes, floor plans, QR checkpoints, and panoramic waypoints for ASU Ibajay.
          </p>
        </div>

        <button
          onClick={signInWithGoogle}
          style={{
            width: "100%",
            maxWidth: 340,
            background: "var(--navi-card)",
            border: "1px solid var(--navi-border)",
            borderRadius: 8,
            padding: "12px 16px",
            color: "var(--navi-text)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        {mockEnabled && (
          <div style={{ maxWidth: 340, marginTop: 20 }}>
            <div style={{ fontSize: 11, color: "var(--navi-text-secondary)", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Mock Auth (Dev Only)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MOCK_USERS.map((u) => (
                <button
                  key={u.id}
                  onClick={() => mockLogin?.(u)}
                  style={{
                    textAlign: "left",
                    background: "var(--navi-card)",
                    border: "1px solid var(--navi-border)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--navi-text)" }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: "var(--navi-text-secondary)" }}>{u.email}</div>
                  </div>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "rgba(37,99,235,0.1)", color: "var(--navi-primary)" }}>
                    {u.role.replace("_", " ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ maxWidth: 340, marginTop: 20, padding: "10px 14px", background: "var(--navi-primary-light)", borderRadius: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--navi-primary)" strokeWidth="2" style={{ marginTop: 1, flexShrink: 0 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span style={{ color: "var(--navi-text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
            Authorized ASU personnel only. All access is logged.
          </span>
        </div>

        <div style={{ marginTop: "auto", paddingTop: 40, color: "var(--navi-text-secondary)", fontSize: 11 }}>
          Aklan State University – Ibajay Campus
        </div>
      </div>

      {/* Right - Visual panel */}
      <div style={{
        flex: 1,
        background: "var(--navi-sidebar)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}>
        <svg style={{ position: "absolute", inset: 0, opacity: 0.04 }} width="100%" height="100%">
          <defs>
            <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#g)" />
        </svg>
        <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
          <svg width="200" height="160" viewBox="0 0 200 160" fill="none">
            {[
              [130, 10, 55, 30], [70, 10, 45, 28], [5, 10, 40, 28],
              [5, 60, 50, 35], [5, 115, 50, 35], [75, 115, 42, 35],
              [135, 115, 50, 35],
            ].map(([x, y, w, h], i) => (
              <rect key={`b${i}`} x={x} y={y} width={w} height={h} rx={3} fill="none" stroke="rgba(37,99,235,0.4)" strokeWidth="1.5" />
            ))}
            <line x1={95} y1={38} x2={95} y2={155} stroke="rgba(6,182,212,0.3)" strokeWidth="4" strokeLinecap="round" />
            <line x1={5} y1={95} x2={185} y2={95} stroke="rgba(6,182,212,0.3)" strokeWidth="4" strokeLinecap="round" />
            {[[95,38],[95,95],[95,115],[95,155],[50,95],[140,95],[155,38],[110,38]].map(([cx, cy], i) => (
              <circle key={`n${i}`} cx={cx} cy={cy} r={4} fill="rgba(37,99,235,0.5)" />
            ))}
          </svg>
          <p style={{ color: "var(--navi-text-sidebar)", fontSize: 13, marginTop: 16, maxWidth: 260, lineHeight: 1.6 }}>
            Multi-campus navigation wayfinding system
          </p>
        </div>
      </div>
    </div>
  );
}
