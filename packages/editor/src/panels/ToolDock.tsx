'use client'

import React, { useState, useRef, useEffect } from 'react'

export interface ToolDockItem {
  id: string
  label: string
  shortcut?: string
  icon: React.ReactNode
}

export interface ToolGroupSubItem {
  id: string
  label: string
  icon: React.ReactNode
}

export interface ToolGroupItem extends ToolDockItem {
  subItems?: ToolGroupSubItem[]
}

export interface ToolGroup {
  id: string
  tools: ToolGroupItem[]
}

export type FloorEditorContext = 'architecture' | 'navigation'

export interface ToolDockProps {
  groups: ToolGroup[]
  activeTool: string
  onActivateTool: (toolId: string) => void
}

const DOCK_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  background: 'var(--navi-card)',
  border: '1px solid var(--navi-border)',
  borderRadius: 8,
  padding: '3px 6px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
}

const SEPARATOR_STYLE: React.CSSProperties = {
  width: 1,
  height: 24,
  background: 'var(--navi-border)',
  margin: '0 3px',
}

function ToolButton({ item, isActive, onActivate }: { item: ToolDockItem; isActive: boolean; onActivate: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onActivate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={hovered ? (item.shortcut ? `${item.label} (${item.shortcut})` : item.label) : item.label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 6,
        border: isActive ? '1px solid var(--navi-primary)' : '1px solid transparent',
        background: isActive ? 'var(--navi-content)' : 'transparent',
        color: isActive ? 'var(--navi-primary)' : 'var(--navi-text-secondary)',
        cursor: 'pointer',
        fontSize: 15,
        lineHeight: 1,
        padding: 0,
        boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
      }}
    >
      {item.icon}
    </button>
  )
}

function GroupedToolButton({ item, isActive, onActivate }: {
  item: ToolGroupItem
  isActive: boolean
  onActivate: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleClick = () => {
    if (!open && item.subItems) {
      if (item.subItems.length === 1) {
        onActivate(item.subItems[0].id)
        return
      }
    }
    setOpen(!open)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ToolButton
        item={item as ToolDockItem}
        isActive={isActive}
        onActivate={handleClick}
      />
      {open && item.subItems && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 4,
          background: 'var(--navi-card)',
          border: '1px solid var(--navi-border)',
          borderRadius: 8,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          zIndex: 100,
        }}>
          {item.subItems.map((sub) => (
            <button
              key={sub.id}
              onClick={() => { onActivate(sub.id); setOpen(false) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'none',
                color: 'var(--navi-text)',
                fontSize: 11,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--navi-content)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              {sub.icon}
              {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ToolDock({ groups, activeTool, onActivateTool }: ToolDockProps) {
  return (
    <div style={DOCK_STYLE}>
      {groups.map((group, gi) => (
        <React.Fragment key={group.id}>
          {gi > 0 && <div style={SEPARATOR_STYLE} />}
          {group.tools.map((item) => {
            if (item.subItems) {
              return (
                <GroupedToolButton
                  key={item.id}
                  item={item}
                  isActive={item.subItems.some(s => s.id === activeTool)}
                  onActivate={(id) => onActivateTool(id)}
                />
              )
            }
            return (
              <ToolButton
                key={item.id}
                item={item}
                isActive={activeTool === item.id}
                onActivate={() => onActivateTool(item.id)}
              />
            )
          })}
        </React.Fragment>
      ))}
    </div>
  )
}

export const ICONS: Record<string, React.ReactNode> = {
  // Tool registry icon names
  cursor: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>,
  select: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>,
  space: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>,
  hallway: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="20" y2="4"/><line x1="8" y1="22" x2="22" y2="8"/><line x1="2" y1="16" x2="16" y2="2"/></svg>,
  wall: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="4" x2="20" y2="20"/><line x1="4" y1="20" x2="20" y2="4"/></svg>,
  door: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>,
  window: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>,
  entrance: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>,
  stairs: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4v-4h4v-4h4V8h4"/></svg>,
  stair: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4v-4h4v-4h4V8h4"/></svg>,
  elevator: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="18" height="20" rx="2" ry="2"/><line x1="12" y1="14" x2="12" y2="22"/><path d="M10 10l2-2 2 2"/><path d="M10 18l2 2 2-2"/></svg>,
  building: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/></svg>,
  road: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><line x1="5" y1="3" x2="5" y2="21"/><line x1="19" y1="3" x2="19" y2="21"/></svg>,
  boundary: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/></svg>,
  align: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="2"/></svg>,
  area: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3"/><path d="M7 21v-3"/><path d="M17 21v-3"/><polygon points="13 2 22 7 22 13 13 18 4 13 4 7"/></svg>,
  poi: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>,
  'poi-circle': <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8"/></svg>,
  'poi-rectangle': <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>,
  'poi-polygon': <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 3 21 9 18 19 6 19 3 9 12 3"/></svg>,
  'route-node': <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/></svg>,
  'route-edge': <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="15 8 19 12 15 16"/></svg>,
  pan: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 13"/></svg>,
  ruler: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/></svg>,
  importIcon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  osmImport: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>,
}

export const INTERIOR_TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'geometry',
    tools: [
      { id: 'select', label: 'Navigate', shortcut: 'V', icon: ICONS.select },
      { id: 'space', label: 'Room', shortcut: 'R', icon: ICONS.space },
      { id: 'hallway', label: 'Hallway', shortcut: 'T', icon: ICONS.hallway },
    ],
  },
  {
    id: 'connections',
    tools: [
      { id: 'entrance', label: 'Entrance', shortcut: 'E', icon: ICONS.entrance },
      { id: 'stair', label: 'Stair', shortcut: 'S', icon: ICONS.stair },
      { id: 'elevator', label: 'Elevator', shortcut: 'I', icon: ICONS.elevator },
    ],
  },
  {
    id: 'alignment',
    tools: [
      { id: 'align', label: 'Align Floor Plan', shortcut: 'A', icon: ICONS.align },
    ],
  },
]

export function buildInteriorToolGroups(
  registry: {
    getByGroup(group: string): Array<{ id: string; name: string; icon: string; shortcut?: string }>
    get?: (id: string) => { id: string; name: string; icon: string; shortcut?: string } | undefined
  },
  iconMap: Record<string, React.ReactNode>,
  context?: FloorEditorContext,
): ToolGroup[] {
  // Keep the legacy two-argument builder stable for the campus/floor panels
  // that still consume the original three-group layout. FloorEditor passes a
  // context explicitly to get the separated authoring surfaces below.
  if (context) {
    const makeTool = (id: string, label: string, idOverride?: string): ToolGroupItem | null => {
      const definition = registry.get?.(id)
      if (!definition) return null
      return {
        id: idOverride ?? definition.id,
        label,
        shortcut: definition.shortcut,
        icon: iconMap[definition.icon] ?? null,
      }
    }

    const architecture: Array<[string, ToolGroupItem[]]> = [
      ['geometry', [
        makeTool('select', 'Navigate'),
        makeTool('space', 'Room'),
        makeTool('wall', 'Wall'),
        makeTool('door', 'Door'),
      ].filter((tool): tool is ToolGroupItem => tool !== null)],
      ['connections', [
        makeTool('entrance', 'Entrance'),
      ].filter((tool): tool is ToolGroupItem => tool !== null)],
      ['alignment', [
        makeTool('align', 'Align Floor Plan'),
      ].filter((tool): tool is ToolGroupItem => tool !== null)],
    ]

    const navigation: Array<[string, ToolGroupItem[]]> = [
      ['navigation', [
        makeTool('select', 'Select'),
        makeTool('hallway', 'Route'),
        makeTool('entrance', 'Entry Point'),
        // The editor canvas uses the stable `stairs` interaction ID while the
        // shared registry keeps the historical `staircase` definition.
        makeTool('staircase', 'Stair', 'stairs'),
        makeTool('elevator', 'Elevator'),
      ].filter((tool): tool is ToolGroupItem => tool !== null)],
    ]

    return (context === 'architecture' ? architecture : navigation).map(([id, tools]) => ({ id, tools }))
  }

  const GROUP_ORDER = ['geometry', 'connections', 'alignment'] as const
  const LABEL_OVERRIDES: Record<string, string> = {
    select: 'Navigate',
    space: 'Room',
    staircase: 'Stair',
  }

  return GROUP_ORDER.map((groupId) => ({
    id: groupId,
    tools: registry.getByGroup(groupId).map((t) => ({
      id: t.id,
      label: LABEL_OVERRIDES[t.id] ?? t.name,
      shortcut: t.shortcut,
      icon: iconMap[t.icon] ?? null,
    })),
  }))
}

export const TOUR_360_TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'tour360',
    tools: [
      { id: 'select', label: 'Navigate', shortcut: 'V', icon: ICONS.select },
      { id: 'place-panorama', label: 'Place Panorama', shortcut: 'P', icon: ICONS.area },
    ],
  },
]

export const CAMPUS_TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'geometry',
    tools: [
      { id: 'select', label: 'Navigate', shortcut: 'V', icon: ICONS.select },
      {
        id: 'import', label: 'Import', icon: ICONS.importIcon,
        subItems: [
          { id: 'import-osm', label: 'Import from OSM', icon: ICONS.osmImport },
          { id: 'set-boundary', label: 'Set Campus Boundary', icon: ICONS.boundary },
        ],
      },
      { id: 'building', label: 'Building', shortcut: 'B', icon: ICONS.building },
      { id: 'route', label: 'Road', shortcut: 'O', icon: ICONS.road },
      {
        id: 'poi', label: 'POI', shortcut: 'P', icon: ICONS.poi,
        subItems: [
          { id: 'poi', label: 'Point', icon: ICONS.poi },
          { id: 'poi-circle', label: 'Circle', icon: ICONS['poi-circle'] },
          { id: 'poi-rectangle', label: 'Rectangle', icon: ICONS['poi-rectangle'] },
          { id: 'poi-polygon', label: 'Polygon', icon: ICONS['poi-polygon'] },
        ],
      },
    ],
  },
]

export function useToolDockShortcuts(groups: ToolGroup[], activeTool: string, onActivateTool: (id: string) => void): void {
  const map = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const m = new Map<string, string>()
    for (const group of groups) {
      for (const tool of group.tools) {
        if (tool.shortcut) m.set(tool.shortcut.toUpperCase(), tool.id)
      }
    }
    map.current = m
  }, [groups])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return
      if (e.key === 'Escape') return
      const shortcut = e.key.toUpperCase()
      const toolId = map.current.get(shortcut)
      if (toolId && toolId !== activeTool) {
        onActivateTool(toolId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTool, onActivateTool])
}
