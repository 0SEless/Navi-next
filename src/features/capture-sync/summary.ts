import type { CaptureSession } from '../capture/types'

export interface CaptureSummaryDetails {
  rawSampleCount: number
  candidateNodeCount: number
  candidateEdgeCount: number
  markerCount: number
}

export function getCaptureSummaryDetails(session: CaptureSession): CaptureSummaryDetails {
  return {
    rawSampleCount: session.rawSamples.length,
    candidateNodeCount: session.candidateRoute?.points.length ?? 0,
    candidateEdgeCount: session.candidateRoute?.edgeCount ?? 0,
    markerCount: session.markers.length,
  }
}
