// Tour types - isolated from NAVI data model
// These types define the standalone 360 tour viewer interface

export interface TourPanorama {
  id: string
  label: string
  imageUrl: string
  heading?: number
  hotspots: TourHotspot[]
}

export interface TourHotspot {
  id: string
  type: 'navigation' | 'information'
  yaw: number
  pitch: number
  label: string
  // Navigation hotspot
  targetPanoramaId?: string
  // Information hotspot
  content?: TourHotspotContent
}

export interface TourHotspotContent {
  title?: string
  description?: string
  imageUrl?: string
  linkUrl?: string
  linkLabel?: string
}

export interface TourViewerState {
  currentPanoramaIndex: number
  isLoading: boolean
  error: string | null
  isFullscreen: boolean
  heading: number
}
