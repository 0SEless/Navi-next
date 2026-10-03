import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useEditor, useDocumentVersion } from '../context'
import type { ValidationSnapshot } from '../validation/snapshot'
import type { ValidationIssue } from '../validation/snapshot'
import type { AutoFixRegistry } from '../validation/fix'
import type { ValidationProfileId, ValidationProfile } from '../validation/rules/types'
import { getProfiles, getDefaultProfile } from '../validation/profiles'
import { presentValidationIssue } from '../validation/presentation'

const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 }

const severityIcon: Record<string, string> = { error: '●', warning: '◆', info: '■' }

const severityColor: Record<string, string> = { error: '#f14c4c', warning: '#cca700', info: '#3794ff' }

interface GroupedIssues {
  severity: string
  children: { category: string; issues: ValidationIssue[] }[]
}

function groupIssues(issues: ReadonlyArray<ValidationIssue>): GroupedIssues[] {
  const groups = new Map<string, Map<string, ValidationIssue[]>>()
  for (const issue of issues) {
    let bySeverity = groups.get(issue.severity)
    if (!bySeverity) {
      bySeverity = new Map()
      groups.set(issue.severity, bySeverity)
    }
    const cat = presentValidationIssue(issue).ruleLabel
    let list = bySeverity.get(cat)
    if (!list) {
      list = []
      bySeverity.set(cat, list)
    }
    list.push(issue)
  }
  const result: GroupedIssues[] = []
  for (const [sev, cats] of groups) {
    const children: { category: string; issues: ValidationIssue[] }[] = []
    for (const [cat, issues] of cats) {
      children.push({
        category: cat,
        issues: [...issues].sort((a, b) => {
          const byMsg = a.message.localeCompare(b.message)
          if (byMsg !== 0) return byMsg
          const aTarget = a.targets[0]?.entityId ?? ''
          const bTarget = b.targets[0]?.entityId ?? ''
          return aTarget.localeCompare(bTarget)
        }),
      })
    }
    children.sort((a, b) => a.category.localeCompare(b.category))
    result.push({ severity: sev, children })
  }
  result.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99))
  return result
}

export interface ProblemsPanelProps {
  entityFilter?: string | null
  categoryFilter?: string | null
  onIssueFocus?: (issue: ValidationIssue) => void
  canIssueFocus?: (issue: ValidationIssue) => boolean
}

export function ProblemsPanel({ entityFilter, categoryFilter, onIssueFocus, canIssueFocus }: ProblemsPanelProps) {
  const { services, document } = useEditor()
  // DocumentStore.version is a UI commit notification counter; the engine
  // validates against CampusDocument.version. Keep the hook for rerenders, but
  // compare the same authoritative version that the snapshot records.
  useDocumentVersion()
  const liveDocumentVersion = document.version
  const engine = services.get('validationEngine')
  const selection = services.get('selection')
  const autoFix = services.get('autoFixRegistry')
  const [snapshot, setSnapshot] = useState<ValidationSnapshot | undefined>(engine?.getLastSnapshot())
  const [expanded, setExpanded] = useState(true)
  const [activeProfile, setActiveProfile] = useState<ValidationProfileId>(getDefaultProfile())
  const prevCount = useRef(0)
  const profiles: ReadonlyArray<ValidationProfile> = getProfiles()

  useEffect(() => {
    if (!engine) return
    const unsub = engine.onValidationUpdated((s) => {
      setSnapshot(s)
    })
    return unsub
  }, [engine])

  const handleRevalidate = useCallback(() => {
    if (!engine || !document) return
    engine.validateFresh(document, activeProfile)
  }, [engine, document, activeProfile])

  const handleProfileChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const profile = e.target.value as ValidationProfileId
    setActiveProfile(profile)
    if (engine && document) {
      engine.validate(document, profile)
    }
  }, [engine, document])

  const handleIssueClick = useCallback((issue: ValidationIssue) => {
    if (onIssueFocus) {
      onIssueFocus(issue)
      return
    }
    const target = issue.targets[0]
    if (target && target.entityId && selection) {
      selection.select(target.entityId as any)
    }
  }, [onIssueFocus, selection])

  const isIssueFocusable = useCallback((issue: ValidationIssue) => {
    if (!onIssueFocus || issue.targets.length === 0) return false
    return canIssueFocus ? canIssueFocus(issue) : true
  }, [canIssueFocus, onIssueFocus])

  const handleFixClick = useCallback((e: React.MouseEvent, issue: ValidationIssue) => {
    e.stopPropagation()
    if (!autoFix) return
    const applied = autoFix.applyFix(issue)
    if (applied && engine && document) {
      engine.validateFresh(document, activeProfile)
    }
  }, [activeProfile, autoFix, engine, document])

  const issues = snapshot?.issues ?? []
  const count = issues.length
  const severityCounts = useMemo(() => {
    const counts = { error: 0, warning: 0, info: 0 }
    for (const issue of issues) {
      if (issue.severity in counts) counts[issue.severity]++
    }
    return counts
  }, [issues])

  const autoExpand = useMemo(() => {
    if (prevCount.current === 0 && count > 0) return true
    return expanded
  }, [count, expanded])

  useEffect(() => {
    prevCount.current = count
  }, [count])

  const filtered = useMemo(() => {
    let result = issues
    if (entityFilter) {
      result = result.filter(i => i.targets.some(t => t.entityId === entityFilter))
    }
    if (categoryFilter) {
      result = result.filter(i => i.ruleId === categoryFilter)
    }
    return result
  }, [issues, entityFilter, categoryFilter])

  const grouped = useMemo(() => groupIssues(filtered), [filtered])
  const isStale = snapshot != null && snapshot.documentVersion !== liveDocumentVersion

  return (
    <div style={{ padding: 12, fontSize: 13, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 8px',
        borderBottom: '1px solid #333',
        cursor: 'pointer',
        userSelect: 'none',
      }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ fontWeight: 600, color: '#fff', textTransform: 'uppercase', fontSize: 11, letterSpacing: 1 }}>
          Problems{snapshot ? ` (${count})` : ''}
          {isStale && <span style={{ color: '#f59e0b', marginLeft: 4, fontSize: 10 }}>● stale</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select
            value={activeProfile}
            onChange={(e) => { e.stopPropagation(); handleProfileChange(e) }}
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#1a1a1a', border: '1px solid #444', color: '#ccc', borderRadius: 3, padding: '1px 4px', fontSize: 11, cursor: 'pointer' }}
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            onClick={(e) => { e.stopPropagation(); handleRevalidate() }}
            title="Re-validate"
            style={{ background: 'none', border: '1px solid #444', color: '#ccc', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', fontSize: 11 }}
          >
            ↻
          </button>
          <span style={{ color: '#666', fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {!snapshot && (
        <div style={{ color: '#999', fontStyle: 'italic', fontSize: 13, padding: '12px 0 4px' }}>
          Run Validate to check this campus
        </div>
      )}
      {snapshot && (
        <>
          <div
            aria-label="Validation summary"
            style={{ display: 'flex', gap: 8, padding: '7px 0 5px', color: '#aaa', fontSize: 11 }}
          >
            <span style={{ color: severityColor.error }}>{severityCounts.error} error{severityCounts.error === 1 ? '' : 's'}</span>
            <span style={{ color: severityColor.warning }}>{severityCounts.warning} warning{severityCounts.warning === 1 ? '' : 's'}</span>
            <span style={{ color: severityColor.info }}>{severityCounts.info} info</span>
          </div>
          <div style={{ color: '#666', fontSize: 10, paddingBottom: 6 }}>
            Profile: {snapshot.profile} · document version {snapshot.documentVersion} · validated at {Math.round(snapshot.validatedAt)}ms
          </div>
          {count === 0 && (
            <div style={{ color: '#666', fontStyle: 'italic', fontSize: 13, padding: '4px 0' }}>
              {entityFilter || categoryFilter ? 'No matching problems' : 'No problems'}
            </div>
          )}
          {autoExpand && grouped.map(group => (
            <div key={group.severity}>
              <div style={{
                padding: '2px 0',
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: severityColor[group.severity] || '#ccc',
                background: 'rgba(255,255,255,0.03)',
                borderBottom: '1px solid #2a2a2a',
              }}>
                {group.severity} ({group.children.reduce((s, c) => s + c.issues.length, 0)})
              </div>
              {group.children.map(cat => (
                <div key={cat.category}>
                  <div style={{ padding: '2px 0', fontSize: 10, color: '#666', borderBottom: '1px solid #2a2a2a' }}>
                    {cat.category}
                  </div>
                  {cat.issues.map(issue => {
                    const presentation = presentValidationIssue(issue)
                    const focusable = isIssueFocusable(issue)
                    const scope = [
                      issue.layer ? `Layer: ${issue.layer}` : null,
                      issue.buildingId ? `Building: ${issue.buildingId}` : null,
                      issue.floorId ? `Floor: ${issue.floorId}` : null,
                    ].filter(Boolean).join(' · ')
                    return (
                      <div
                        key={issue.issueId}
                        onClick={() => handleIssueClick(issue)}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                          padding: '6px 0',
                          borderBottom: '1px solid #2a2a2a',
                          cursor: onIssueFocus || selection ? 'pointer' : 'default',
                        }}
                      >
                        <span style={{ color: severityColor[issue.severity] || '#ccc', fontSize: 10, marginTop: 3, flexShrink: 0 }}>
                          {severityIcon[issue.severity] || '○'}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: '#fff', wordBreak: 'break-word', fontWeight: 600 }}>
                            {presentation.title}
                          </div>
                          <div style={{ color: '#ccc', wordBreak: 'break-word', marginTop: 2 }}>{issue.message}</div>
                          <div style={{ color: '#999', wordBreak: 'break-word', marginTop: 2, fontSize: 11 }}>
                            {presentation.guidance}
                          </div>
                          {scope && (
                            <div style={{ color: '#888', fontSize: 11, marginTop: 3 }}>{scope}</div>
                          )}
                          {issue.targets.length > 0 && (
                            <div style={{ color: '#666', fontSize: 11, marginTop: 1 }}>
                              {issue.targets.map(t => `${t.entityType}: ${t.entityId}`).join(', ')}
                            </div>
                          )}
                          {focusable && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onIssueFocus?.(issue) }}
                              style={{
                                marginTop: 5,
                                background: 'transparent',
                                border: '1px solid #555',
                                color: '#ddd',
                                borderRadius: 3,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                fontSize: 11,
                              }}
                            >
                              Show on map
                            </button>
                          )}
                          {issue.fixId && autoFix?.canFix(issue) && (
                            <button
                              type="button"
                              onClick={(e) => handleFixClick(e, issue)}
                              style={{
                                marginTop: 4,
                                marginLeft: focusable ? 5 : 0,
                                background: '#2a6e3f',
                                border: 'none',
                                color: '#fff',
                                borderRadius: 3,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                fontSize: 11,
                              }}
                            >
                              Fix
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
