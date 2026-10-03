export type { FixProvider, FixContext } from './types'
export { AutoFixRegistry } from './registry'
export {
  assignUntitledFix,
  assignFloorLevelFix,
  clearRoadReferenceFix,
  clearEntranceReferenceFix,
} from './modules/metadata-fixes'
export { closePolygonFix } from './modules/geometry-fixes'
