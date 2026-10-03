export interface CampusMap {
  id: string
  name: string
  schoolName: string
  campusName?: string
  imageUrl?: string
  boundary: { lat: number; lng: number }[]
  center: { lat: number; lng: number }
  createdAt: string
  updatedAt: string
  stats: {
    buildings: number
    nodes: number
    edges: number
  }
}

export interface LandmarkType {
  id: string
  mapId: string
  name: string
  color: string
  icon: string
}

export interface LandmarkInstance {
  id: string
  mapId: string
  typeId: string
  polygon?: { lat: number; lng: number }[]
  position: { lat: number; lng: number }
  label?: string
}
