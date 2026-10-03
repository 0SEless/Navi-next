import type { ValidationIssue } from './snapshot'

export interface ValidationIssuePresentation {
  readonly ruleLabel: string
  readonly title: string
  readonly guidance: string
}

interface RuleCopy {
  readonly ruleLabel: string
  readonly title: string
  readonly guidance: string
}

const RULE_COPY: Record<string, RuleCopy> = {
  'route-network-disconnected': {
    ruleLabel: 'Route network',
    title: 'Disconnected route network',
    guidance: 'Connect the isolated route nodes or edges to the rest of the route network, then validate again.',
  },
  'route-network-structure': {
    ruleLabel: 'Route network',
    title: 'Route network structure is invalid',
    guidance: 'Inspect the route nodes and edges for missing or invalid connections, then validate again.',
  },
  'route-entrance-access': {
    ruleLabel: 'Route access',
    title: 'Entrance route access is invalid',
    guidance: 'Inspect the building entrance and connect it to a valid indoor or outdoor route, then validate again.',
  },
  'route-entrance-accessibility': {
    ruleLabel: 'Route access',
    title: 'Entrance route access is invalid',
    guidance: 'Inspect the building entrance and connect it to a valid indoor or outdoor route, then validate again.',
  },
  'polygon-closure': {
    ruleLabel: 'Geometry',
    title: 'Polygon is not closed',
    guidance: 'Close the polygon by joining its final point to its first point, then validate again.',
  },
}

function humanizeRuleId(ruleId: string): string {
  const words = ruleId
    .split(/[-_.\s]+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) return 'Validation issue'

  return words
    .map((word, index) => {
      const normalized = word.toLowerCase()
      return index === 0
        ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
        : normalized
    })
    .join(' ')
}

function fallbackCopy(ruleId: string): RuleCopy {
  return {
    ruleLabel: 'Custom rule',
    title: humanizeRuleId(ruleId),
    guidance: 'Inspect the affected map element or layer, resolve the reported condition, then validate again.',
  }
}

export function presentValidationIssue(issue: ValidationIssue): ValidationIssuePresentation {
  const copy = RULE_COPY[issue.ruleId] ?? fallbackCopy(issue.ruleId)
  const targetNote = issue.targets.length === 0
    ? ' No specific map target is available; inspect the affected layer or graph structure.'
    : ''

  return {
    ruleLabel: copy.ruleLabel,
    title: copy.title,
    guidance: `${copy.guidance}${targetNote}`,
  }
}
