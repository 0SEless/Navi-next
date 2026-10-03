import type { CampusDocument, Building, Road, Panorama, QRCheckpoint, Room, Hallway, LegacyStaircase, LegacyElevator, Entrance, LatLng, OutdoorPointOfInterest, PointOfInterest, PointOfInterestGeometry, WorldPOIGeometry } from '@navi/core'
import { CoordinateTransformer, resolveOutdoorPointOfInterestAppearance, resolvePointOfInterestAppearance, resolvePointOfInterestGeometry, resolvePoiVisibility, roadTypeColor, validatePointOfInterestGeometry, worldCirclePoints } from '@navi/core'

function latLngToCoords(p: LatLng): [number, number] {
  return [p.lng, p.lat]
}

function localToWorld(local: { x: number; y: number }, buildingId: string, transformer: CoordinateTransformer): [number, number] | null {
  const world = transformer.buildingLocalToWorld(local, buildingId)
  if (!world) return null
  return [world.lng, world.lat]
}

function floorLocalToWorld(local: { x: number; y: number }, buildingId: string, level: number, transformer: CoordinateTransformer): [number, number] | null {
  const world = transformer.floorLocalToWorld(local, buildingId, level)
  if (!world) return null
  return [world.lng, world.lat]
}

function circleLocalPoints(center: { x: number; y: number }, radius: number, segments = 32): Array<{ x: number; y: number }> {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
}

function poiGeometryToWorld(
  poi: PointOfInterest,
  buildingId: string,
  floorLevel: number,
  transformer: CoordinateTransformer,
): { geometry: GeoJSON.Geometry; geometryType: PointOfInterestGeometry['type'] } | null {
  const geometry = resolvePointOfInterestGeometry(poi)
  if (!geometry || !validatePointOfInterestGeometry(geometry).valid) return null

  if (geometry.type === 'point') {
    const coordinate = floorLocalToWorld(geometry.position, buildingId, floorLevel, transformer)
    return coordinate ? { geometry: { type: 'Point', coordinates: coordinate }, geometryType: 'point' } : null
  }

  const localPoints = geometry.type === 'circle'
    ? circleLocalPoints(geometry.center, geometry.radius)
    : geometry.type === 'rectangle'
      ? [
          { x: geometry.min.x, y: geometry.min.y },
          { x: geometry.max.x, y: geometry.min.y },
          { x: geometry.max.x, y: geometry.max.y },
          { x: geometry.min.x, y: geometry.max.y },
        ]
      : geometry.points
  const worldPoints = localPoints
    .map(point => floorLocalToWorld(point, buildingId, floorLevel, transformer))
    .filter((point): point is [number, number] => point !== null)
  if (worldPoints.length < 3) return null
  return {
    geometry: { type: 'Polygon', coordinates: [[...worldPoints, worldPoints[0]]] },
    geometryType: geometry.type,
  }
}

export interface YearnOptions {
  transformer?: CoordinateTransformer
}

function buildingToFeature(b: Building): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: b.id,
    properties: { id: b.id, name: b.name, code: b.code, category: b.category, color: b.color, height: b.height, base_elevation: b.baseElevation ?? 0 },
    geometry: {
      type: 'Polygon',
      coordinates: [b.footprint.points.map(latLngToCoords)],
    },
  }
}

function floorFeatures(building: Building, transformer?: CoordinateTransformer): GeoJSON.Feature[] {
  if (!transformer) return []
  const features: GeoJSON.Feature[] = []
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      const coords = room.polygon.points.map(p => localToWorld(p, building.id, transformer)).filter(Boolean) as [number, number][]
      if (coords.length >= 3) {
        features.push({
          type: 'Feature',
          id: room.id,
          properties: { id: room.id, name: room.name, number: room.number, category: room.category, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'room' },
          geometry: { type: 'Polygon', coordinates: [coords] },
        })
      }
    }
    for (const hw of floor.hallways) {
      const coords = hw.polyline.points.map(p => localToWorld(p, building.id, transformer)).filter(Boolean) as [number, number][]
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          id: hw.id,
          properties: { id: hw.id, name: hw.name, width: hw.width, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'hallway' },
          geometry: { type: 'LineString', coordinates: coords },
        })
      }
    }
    for (const st of floor.staircases) {
      const coord = localToWorld(st.position, building.id, transformer)
      if (coord) {
        features.push({
          type: 'Feature',
          id: st.id,
          properties: { id: st.id, name: st.name, fromLevel: st.fromLevel, toLevel: st.toLevel, type: st.type, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'staircase' },
          geometry: { type: 'Point', coordinates: coord },
        })
      }
    }
    for (const el of floor.elevators) {
      const coord = localToWorld(el.position, building.id, transformer)
      if (coord) {
        features.push({
          type: 'Feature',
          id: el.id,
          properties: { id: el.id, name: el.name, fromLevel: el.fromLevel, toLevel: el.toLevel, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'elevator' },
          geometry: { type: 'Point', coordinates: coord },
        })
      }
    }
    for (const ent of floor.entrances) {
      // P1-T4 (D9): entrance positions are building-local — derive world for the
      // GeoJSON feature; legacy world-stored records pass through verbatim.
      const legacyWorld = (ent.position as unknown as { lat?: number }).lat !== undefined
        ? (ent.position as unknown as { lat: number; lng: number })
        : (transformer ? localToWorld(ent.position, building.id, transformer) : null)
      if (!legacyWorld) continue
      features.push({
        type: 'Feature',
        id: ent.id,
        properties: { id: ent.id, label: ent.label, level: ent.level, type: ent.type, hasQR: ent.hasQR, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'entrance' },
        geometry: { type: 'Point', coordinates: latLngToCoords(legacyWorld) },
      })
    }
    for (const poi of floor.pois ?? []) {
      const rendered = poiGeometryToWorld(poi, building.id, floor.level, transformer)
      if (!rendered) continue
      const appearance = resolvePointOfInterestAppearance(poi)
      if (!appearance) continue
      features.push({
        type: 'Feature',
        id: poi.id,
        properties: {
          id: poi.id,
          name: poi.name,
          category: poi.category,
          buildingId: building.id,
          floorId: floor.id,
          floor: floor.level,
          entityType: 'poi',
          geometryType: rendered.geometryType,
          appearanceMode: appearance.mode,
          showOnMap: resolvePoiVisibility(poi.visibility).showOnMap,
          ...(appearance.color !== undefined ? { color: appearance.color } : {}),
          ...(appearance.mode === '2.5d'
            ? {
                appearanceHeight: appearance.height,
                base_elevation: building.baseElevation + floor.elevation,
              }
            : {}),
        },
        geometry: rendered.geometry,
      })
    }
  }
  return features
}

function roadToFeature(r: Road): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: r.id,
    properties: {
      id: r.id, name: r.name, width: r.width, surface: r.surface, type: r.type,
      displayMode: r.displayMode ?? 'visible',
      entityType: 'road',
      color: (r.metadata?.color as string) || roadTypeColor(r.type),
    },
    geometry: {
      type: 'LineString',
      coordinates: r.polyline.points.map(latLngToCoords),
    },
  }
}

function panoramaToFeature(p: Panorama, doc: CampusDocument, transformer?: CoordinateTransformer): GeoJSON.Feature {
  // P1-T4 (D9): panorama positions are building-local — convert via the owning
  // building's transform; legacy world-stored records pass through verbatim.
  let coord: [number, number] | null = null
  const legacyWorld = (p.position as unknown as { lat?: number }).lat !== undefined
    ? (p.position as unknown as { lat: number; lng: number })
    : (p.buildingId && transformer
      ? localToWorld(p.position, p.buildingId, transformer)
      : null)
  if (legacyWorld) coord = latLngToCoords(legacyWorld)
  if (!coord) coord = [0, 0]
  return {
    type: 'Feature',
    id: p.id,
    properties: { id: p.id, label: p.label, heading: p.heading, imageAssetId: p.imageAssetId, buildingId: p.buildingId, floor: p.floor, entityType: 'panorama' },
    geometry: { type: 'Point', coordinates: coord },
  }
}

function qrToFeature(q: QRCheckpoint, doc: CampusDocument, transformer?: CoordinateTransformer): GeoJSON.Feature {
  // P1-T4 (D9): QR positions are building-local — same derivation as panoramas.
  let coord: [number, number] | null = null
  const legacyWorld = (q.position as unknown as { lat?: number }).lat !== undefined
    ? (q.position as unknown as { lat: number; lng: number })
    : (transformer ? localToWorld(q.position, q.buildingId, transformer) : null)
  if (legacyWorld) coord = latLngToCoords(legacyWorld)
  if (!coord) coord = [0, 0]
  return {
    type: 'Feature',
    id: q.id,
    properties: { id: q.id, label: q.label, code: q.code, buildingId: q.buildingId, floor: q.floor, entityType: 'qr' },
    geometry: { type: 'Point', coordinates: coord },
  }
}

/** Convert an authored world-geometry POI into a MapLibre GeoJSON feature. */
function outdoorPoiToFeature(poi: OutdoorPointOfInterest): GeoJSON.Feature | null {
  const appearance = resolveOutdoorPointOfInterestAppearance(poi)
  if (!appearance) return null

  const geometry = worldPoiGeometryToGeoJSON(poi.geometry)
  if (!geometry) return null

  return {
    type: 'Feature',
    id: poi.id,
    properties: {
      id: poi.id,
      name: poi.name,
      category: poi.category,
      entityType: 'poi',
      scope: 'outdoor',
      geometryType: poi.geometry.type,
      appearanceMode: appearance.mode,
      showOnMap: resolvePoiVisibility(poi.visibility).showOnMap,
      ...(appearance.color !== undefined ? { color: appearance.color } : {}),
      ...(appearance.mode === '2.5d'
        ? {
            appearanceHeight: appearance.height,
            base_elevation: 0,
          }
        : {}),
    },
    geometry,
  }
}

function worldPoiGeometryToGeoJSON(geometry: WorldPOIGeometry): GeoJSON.Geometry | null {
  if (geometry.type === 'point') {
    return { type: 'Point', coordinates: latLngToCoords(geometry.position) }
  }

  if (geometry.type === 'circle') {
    const ring = worldCirclePoints(geometry.center, geometry.radius).map(latLngToCoords)
    if (ring.length < 3) return null
    return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
  }

  const ring = geometry.points.map(latLngToCoords)
  if (ring.length < 3) return null
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
}

export function documentToGeoJSON(doc: CampusDocument, opts?: YearnOptions): Record<string, GeoJSON.FeatureCollection> {
  const transformer = opts?.transformer

  const buildingFeatures = doc.buildings.map(buildingToFeature)

  const roomFeatures: GeoJSON.Feature[] = []
  const hallwayFeatures: GeoJSON.Feature[] = []
  const staircaseFeatures: GeoJSON.Feature[] = []
  const elevatorFeatures: GeoJSON.Feature[] = []
  const entranceFeatures: GeoJSON.Feature[] = []
  const poiFeatures: GeoJSON.Feature[] = []

  if (transformer) {
    for (const bld of doc.buildings) {
      const features = floorFeatures(bld, transformer)
      for (const f of features) {
        const et = f.properties?.entityType
        if (et === 'room') roomFeatures.push(f)
        else if (et === 'hallway') hallwayFeatures.push(f)
        else if (et === 'staircase') staircaseFeatures.push(f)
        else if (et === 'elevator') elevatorFeatures.push(f)
        else if (et === 'entrance') entranceFeatures.push(f)
        else if (et === 'poi') poiFeatures.push(f)
      }
    }
  }

  // Outdoor/campus POIs are world-space and do not need a building transformer.
  for (const poi of doc.pois ?? []) {
    const feature = outdoorPoiToFeature(poi)
    if (feature) poiFeatures.push(feature)
  }

  return {
    'buildings': { type: 'FeatureCollection', features: buildingFeatures },
    'rooms': { type: 'FeatureCollection', features: roomFeatures },
    'hallways': { type: 'FeatureCollection', features: hallwayFeatures },
    'roads': { type: 'FeatureCollection', features: doc.roads.map(roadToFeature) },
    'panoramas': { type: 'FeatureCollection', features: doc.panoramas.map(p => panoramaToFeature(p, doc, transformer)) },
    'qr': { type: 'FeatureCollection', features: doc.qrCheckpoints.map(q => qrToFeature(q, doc, transformer)) },
    'staircases': { type: 'FeatureCollection', features: staircaseFeatures },
    'elevators': { type: 'FeatureCollection', features: elevatorFeatures },
    'entrances': { type: 'FeatureCollection', features: entranceFeatures },
    'pois': { type: 'FeatureCollection', features: poiFeatures },
  }
}

export function toPreviewFeature(geometry: GeoJSON.Geometry, properties?: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: properties || {},
    geometry,
  }
}
