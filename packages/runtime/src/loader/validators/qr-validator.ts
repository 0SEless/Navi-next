import type { QrIndexFile } from '@navi/core'
import type { ArtifactValidator } from '../artifact-hydrator'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// P1-T13 (R10.2): qr-index.json validator — the artifact must carry a
// checkpoint list; every checkpoint needs an id and a building-local
// position (no world-coordinate assumptions, R10.3).
export const qrValidator: ArtifactValidator<QrIndexFile> = {
  artifactType: 'qrIndex',
  supportedSchemaVersion: '1.0.0',
  validate(data: unknown): data is QrIndexFile {
    if (!isRecord(data)) return false
    if (typeof data.campusId !== 'string' || data.campusId.length === 0) return false
    if (!Array.isArray(data.checkpoints)) return false
    for (const c of data.checkpoints) {
      if (!isRecord(c)) return false
      if (typeof c.id !== 'string' || c.id.length === 0) return false
      if (typeof c.buildingId !== 'string') return false
      if (typeof c.floor !== 'number') return false
      const pos = c.position
      if (!isRecord(pos) || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false
    }
    return true
  },
}