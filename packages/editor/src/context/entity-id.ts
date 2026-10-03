// ── Branded EntityId ──────────────────────────────────────────
// Prevents accidental mixing of different ID types at compile time
// while remaining a string at runtime.

declare const ENTITY_BRAND: unique symbol

export type EntityId = string & { [ENTITY_BRAND]: 'EntityId' }

/** Convenience: cast a string to EntityId. Use sparingly — prefer typed constructors. */
export function asEntityId(id: string): EntityId {
  return id as EntityId
}

// ── Entity Type Names ─────────────────────────────────────────

export type EntityType =
  | 'building'
  | 'floor'
  | 'room'
  | 'hallway'
  | 'staircase'
  | 'elevator'
  | 'entrance'
  | 'road'
  | 'panorama'
  | 'qr'
  | 'area'
  | 'poi'
  | 'door'

// ── EntitySelector — discriminated union per entity type ──────
// Uniquely identifies any entity in the document tree.

export interface BuildingSelector {
  type: 'building'
  id: EntityId
}

export interface FloorSelector {
  type: 'floor'
  id: EntityId
  buildingId: EntityId
}

export interface RoomSelector {
  type: 'room'
  id: EntityId
  buildingId: EntityId
  floorId: EntityId
}

export interface HallwaySelector {
  type: 'hallway'
  id: EntityId
  buildingId: EntityId
  floorId: EntityId
}

export interface StaircaseSelector {
  type: 'staircase'
  id: EntityId
  buildingId: EntityId
  floorId: EntityId
}

export interface ElevatorSelector {
  type: 'elevator'
  id: EntityId
  buildingId: EntityId
  floorId: EntityId
}

export interface EntranceSelector {
  type: 'entrance'
  id: EntityId
  buildingId: EntityId
  floorId: EntityId
}

export interface RoadSelector {
  type: 'road'
  id: EntityId
}

export interface PanoramaSelector {
  type: 'panorama'
  id: EntityId
}

export interface QRSelector {
  type: 'qr'
  id: EntityId
}

export interface AreaSelector {
  type: 'area'
  id: EntityId
}

/**
 * An authored POI landmark. Indoor POIs carry their owning building/floor;
 * outdoor/campus POIs omit both (world scope, no floor context).
 */
export interface PoiSelector {
  type: 'poi'
  id: EntityId
  buildingId?: EntityId
  floorId?: EntityId
}

// P1-T6 (R2.4/R9.2/D7): doors are independently selectable entities —
// a door selector must never be coerced into its owning room's selector.
export interface DoorSelector {
  type: 'door'
  id: EntityId
  buildingId: EntityId
  floorId: EntityId
  roomId: EntityId
}

export type EntitySelector =
  | BuildingSelector
  | FloorSelector
  | RoomSelector
  | HallwaySelector
  | StaircaseSelector
  | ElevatorSelector
  | EntranceSelector
  | RoadSelector
  | PanoramaSelector
  | QRSelector
  | AreaSelector
  | PoiSelector
  | DoorSelector

// ── Selection metadata ────────────────────────────────────────

export enum SelectionOrigin {
  Canvas = 'canvas',
  Explorer = 'explorer',
  Keyboard = 'keyboard',
  Programmatic = 'programmatic',
}

export type SelectionMode = 'single' | 'multi' | 'marquee'

// ── SelectionState — snapshot of the full selection state ─────

export interface SelectionState {
  /** Currently selected entity selectors (in order of selection). */
  selected: EntitySelector[]
  /** The entity currently hovered (or null). */
  hovered: EntitySelector | null
  /** Current selection mode. */
  mode: SelectionMode
  /** Where the last selection originated. */
  origin: SelectionOrigin
  /** The last-selected entity (for context actions). */
  lastSelected: EntitySelector | null
}
