import type { ReactNode } from 'react'

// ── Design Tokens ──────────────────────────────────────────────
export const tokens = {
  bg: '#0F172A',
  surface: '#1E293B',
  surfaceHover: '#334155',
  inputBg: '#1E293B',
  border: '#334155',
  borderFocus: '#3B82F6',
  borderDanger: '#5C1A1A',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  accent: '#3B82F6',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  radius: { sm: 4, md: 6, lg: 8 },
  fontSize: { xs: 10, sm: 11, base: 12, md: 13, lg: 14 },
} as const

// ── Shared Styles ──────────────────────────────────────────────

export const inputStyle: React.CSSProperties = {
  width: '100%',
  background: tokens.inputBg,
  color: tokens.textPrimary,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radius.sm,
  padding: '5px 8px',
  fontSize: tokens.fontSize.base,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  outline: 'none',
}

export const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5,
}

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
  paddingRight: 24,
}

export const rangeStyle: React.CSSProperties = {
  width: 120,
  verticalAlign: 'middle',
  accentColor: tokens.accent,
}

export const checkboxStyle: React.CSSProperties = {
  accentColor: tokens.accent,
  width: 16,
  height: 16,
  cursor: 'pointer',
}

export const labelStyle: React.CSSProperties = {
  color: tokens.textSecondary,
  fontSize: tokens.fontSize.sm,
  fontWeight: 500,
  marginBottom: 4,
}

export const valueTextStyle: React.CSSProperties = {
  color: tokens.textPrimary,
  fontSize: tokens.fontSize.md,
}

export const mutedTextStyle: React.CSSProperties = {
  color: tokens.textMuted,
  fontSize: tokens.fontSize.sm,
}

// ── Section Header ─────────────────────────────────────────────
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{
      color: tokens.textSecondary,
      fontSize: tokens.fontSize.xs,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      borderTop: `1px solid ${tokens.border}`,
      paddingTop: 14,
      marginTop: 14,
      marginBottom: 8,
    }}>
      {children}
    </div>
  )
}

// ── Entity Badge ───────────────────────────────────────────────
const ENTITY_COLORS: Record<string, string> = {
  building: '#4A90D9', floor: '#6B7280', room: '#87CEEB',
  hallway: '#B0C4DE', road: '#FFD700', entrance: '#FF8C00',
  staircase: '#20B2AA', elevator: '#9370DB',
  panorama: '#FF69B4', qr: '#32CD32', area: '#FF6347',
}

export function EntityBadge({ label, entityId }: { label: string; entityId?: string }) {
  const color = ENTITY_COLORS[label.toLowerCase()] ?? tokens.textMuted
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      paddingBottom: 10, borderBottom: `1px solid ${tokens.border}`,
      marginBottom: 4,
    }}>
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: tokens.radius.sm,
        background: color, color: '#fff',
        fontSize: tokens.fontSize.xs, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        lineHeight: '18px',
      }}>
        {label}
      </span>
      {entityId && (
        <span style={{
          color: tokens.textMuted, fontSize: tokens.fontSize.xs,
          fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {entityId}
        </span>
      )}
    </div>
  )
}

// ── Buttons ────────────────────────────────────────────────────
export function ActionButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'danger' | 'success' }) {
  const { variant = 'default', style, ...rest } = props
  const variants: Record<string, React.CSSProperties> = {
    default: {
      background: tokens.surface, color: tokens.textPrimary,
      border: `1px solid ${tokens.border}`,
    },
    danger: {
      background: '#2A1010', color: tokens.danger,
      border: `1px solid ${tokens.borderDanger}`,
    },
    success: {
      background: '#0A2E1A', color: tokens.success,
      border: `1px solid #1A6B3A`,
    },
  }
  return (
    <button
      {...rest}
      style={{
        display: 'block', width: '100%',
        padding: '7px 10px', borderRadius: tokens.radius.sm,
        fontSize: tokens.fontSize.base, cursor: 'pointer',
        textAlign: 'left', marginBottom: 4,
        fontFamily: 'inherit', lineHeight: 1.4,
        ...variants[variant],
        ...(style as React.CSSProperties),
      }}
    />
  )
}

// ── Field ──────────────────────────────────────────────────────
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  )
}
