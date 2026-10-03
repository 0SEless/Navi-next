import type { CaptureImportManifest } from '../capture-import/manifest'

export function hasImportedCaptureSessionHere(
  manifest: CaptureImportManifest,
  source: { captureSessionId: string; campusId: string },
): boolean {
  return manifest.imports.some((entry) => (
    entry.captureSessionId === source.captureSessionId
    && entry.campusId === source.campusId
  ))
}
