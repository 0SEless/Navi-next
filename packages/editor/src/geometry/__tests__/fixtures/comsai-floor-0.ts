import type { RoomAttributes, Wall } from '@navi/core'

export const COMSAI_BUILDING_ID = 'osm-bldg-888026366'
export const COMSAI_FLOOR_ID = 'flr-2-uc1f'

/**
 * Exact wall geometry from graph_snapshots.id=6696 for map-map-1-k6bv.
 * Keep these authored coordinates unchanged: the fixture is evidence, not a
 * repaired or snapped approximation of the floor plan.
 */
export const COMSAI_FLOOR_0_WALLS: Wall[] = [
  { id: 'wall-2-1c76', start: { x: -11.536018203943968, y: -8.7311275631655 }, end: { x: 19.29587915353477, y: -5.29296850040555 }, height: 3.5, thickness: 0.15 },
  { id: 'wall-3-ouxl', start: { x: -12.613119592890143, y: 0.8314968016929924 }, end: { x: 18.301300950348377, y: 4.252438521478325 }, height: 3.5, thickness: 0.15 },
  { id: 'wall-4-snic', start: { x: -12.613119592890143, y: 0.8314968016929924 }, end: { x: -11.536018203943968, y: -8.7311275631655 }, height: 3.5, thickness: 0.15 },
  { id: 'wall-5-6ejo', start: { x: -8.169820399954915, y: 1.3270572223700583 }, end: { x: -7.124782903119922, y: -8.246232683304697 }, height: 3.5, thickness: 0.15 },
  { id: 'wall-7-88hi', start: { x: 0.643235057592392, y: 2.292656552279368 }, end: { x: 1.7002805098891258, y: -7.26220464752987 }, height: 3.5, thickness: 0.15 },
  { id: 'wall-9-axn5', start: { x: 9.45656249858439, y: 3.265160762704909 }, end: { x: 10.472155088558793, y: -6.268974012229592 }, height: 3.5, thickness: 0.15 },
  { id: 'wall-10-uqrc', start: { x: 18.301300950348377, y: 4.252438521478325 }, end: { x: 19.29587915353477, y: -5.29296850040555 }, height: 3.5, thickness: 0.15 },
]

export const COMSAI_FLOOR_0_ROOM_ATTRIBUTES: RoomAttributes[] = [
  { name: 'Room', faceId: 'face-shxuk2', roomId: 'room-6-rj98', searchable: true },
  { name: 'Room', faceId: 'face-1x8o5ck', roomId: 'room-11-olw1', searchable: true },
]

