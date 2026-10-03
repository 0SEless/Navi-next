import type { ValidationRule, ValidationContext } from '../types'
import type { ValidationIssue } from '../../snapshot'

export const orphanReferenceRule: ValidationRule = {
  ruleId: 'orphan-reference',
  description: 'Orphaned references',
  category: 'integrity',
  defaultSeverity: 'warning',
  profiles: ['draft', 'publish', 'strict'],
  affinity: 'global',

  execute(context: ValidationContext): ReadonlyArray<ValidationIssue> {
    const issues: ValidationIssue[] = []
    const buildingIds = new Set(context.document.buildings.map(b => b.id))

    for (const pano of context.document.panoramas) {
      if (pano.buildingId && !buildingIds.has(pano.buildingId)) {
        issues.push({
          issueId: `orphan-panorama:${pano.id}`,
          ruleId: 'orphan-reference',
          severity: 'warning',
          message: `Panorama "${pano.label}" references deleted building "${pano.buildingId}"`,
          targets: [{ entityId: pano.id, entityType: 'panorama' }],
        })
      }
    }

    for (const qr of context.document.qrCheckpoints) {
      if (!buildingIds.has(qr.buildingId)) {
        issues.push({
          issueId: `orphan-qr:${qr.id}`,
          ruleId: 'orphan-reference',
          severity: 'warning',
          message: `QR checkpoint "${qr.label}" references deleted building "${qr.buildingId}"`,
          targets: [{ entityId: qr.id, entityType: 'checkpoint' }],
        })
      }
    }

    return issues
  },
}
