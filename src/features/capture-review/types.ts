import type { CampusMap } from '@/types/campus-map'
import type { CaptureSession } from '@/features/capture/types'

export type CaptureReviewSource = 'local-session' | 'local-file' | 'remote-session'

export type ReviewLayerKey = 'rawGps' | 'candidateRoute' | 'candidateNodes' | 'markers' | 'gpsWarnings'
export type ReviewDecision = 'included' | 'excluded'

export interface CaptureReviewSelection {
  routeSegments: Record<string, ReviewDecision>
  markers: Record<string, ReviewDecision>
}

export interface CaptureReviewItem {
  id: string
  sessionId: string
  session: CaptureSession
  source: CaptureReviewSource
  campusLabel: string
}

export interface CaptureReviewMetrics {
  distanceMeters: number
  durationSeconds: number
  candidateNodeCount: number
  candidateEdgeCount: number
  markerCount: number
  warningSampleCount: number
  warningSegmentCount: number
}

export interface AccuracyWarningSegment {
  id: string
  sampleIndices: [number, number]
  points: [{ latitude: number; longitude: number }, { latitude: number; longitude: number }]
  reason: 'missing-accuracy' | 'low-accuracy'
}

export interface CaptureReviewGeoJson {
  campus: GeoJSON.FeatureCollection
  rawRoute: GeoJSON.FeatureCollection
  candidateRoute: GeoJSON.FeatureCollection
  candidateNodes: GeoJSON.FeatureCollection
  markers: GeoJSON.FeatureCollection
  gpsWarnings: GeoJSON.FeatureCollection
}

export interface CaptureReviewCampusContext {
  map: CampusMap | null
  label: string
}
