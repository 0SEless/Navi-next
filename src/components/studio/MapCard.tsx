'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, MoreVertical, Building2, MapPin, Route, Trash2, Eye, Pencil, MapPinned } from 'lucide-react'
import type { CampusMap } from '@/types/campus-map'

interface MapCardProps {
  map?: CampusMap
  onCreate?: () => void
  onView?: (id: string) => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
  onCaptureLibrary?: (id: string) => void
}

export function MapCard({ map, onCreate, onView, onEdit, onDelete, onCaptureLibrary }: MapCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])
  return (
    <div style={{
      background: 'var(--navi-card)',
      border: map ? '1px solid var(--navi-border)' : '2px dashed var(--navi-border)',
      borderRadius: 10,
      overflow: 'hidden',
      cursor: map ? 'pointer' : 'pointer',
      transition: 'transform 0.15s, box-shadow 0.15s',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      minHeight: 200,
    }}
      onClick={() => map ? onView?.(map.id) : onCreate?.()}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {map ? (
        <>
          <div style={{
            height: 120,
            background: 'linear-gradient(135deg, #1C6BEB 0%, #7C3AED 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 36,
            fontWeight: 700,
          }}>
            {map.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navi-text)' }}>{map.name}</div>
            <div style={{ fontSize: 11, color: 'var(--navi-text-secondary)' }}>
              {map.schoolName}{map.campusName ? ` · ${map.campusName}` : ''}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 11, color: 'var(--navi-text-secondary)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Building2 size={11} /> {map.stats?.buildings ?? 0}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <MapPin size={11} /> {map.stats?.nodes ?? 0}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Route size={11} /> {map.stats?.edges ?? 0}
              </span>
            </div>
          </div>
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <div ref={menuRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
                aria-label={`Open actions for ${map.name}`}
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: 'none',
                  borderRadius: 6,
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#fff',
                }}
              >
                <MoreVertical size={14} />
              </button>
              {menuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 32,
                    right: 0,
                    background: 'var(--navi-card)',
                    border: '1px solid var(--navi-border)',
                    borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    zIndex: 10,
                    minWidth: 140,
                    overflow: 'hidden',
                  }}
                >
                  {[
                    { label: 'Preview', icon: Eye, action: () => { setMenuOpen(false); onView?.(map.id) } },
                    { label: 'Edit', icon: Pencil, action: () => { setMenuOpen(false); onEdit?.(map.id) } },
                    { label: 'Capture Library', icon: MapPinned, action: () => { setMenuOpen(false); onCaptureLibrary?.(map.id) } },
                    { label: 'Delete', icon: Trash2, action: () => { setMenuOpen(false); onDelete?.(map.id) } },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={(e) => { e.stopPropagation(); item.action(); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '8px 12px',
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: item.label === 'Delete' ? '#EF4444' : 'var(--navi-text)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--navi-content)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                    >
                      <item.icon size={13} />
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          color: 'var(--navi-text-secondary)',
          padding: 24,
        }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--navi-content)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={20} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navi-text)' }}>Create New Map</div>
          <div style={{ fontSize: 11, textAlign: 'center' }}>Set up a new campus map with buildings and landmarks</div>
        </div>
      )}
    </div>
  )
}
