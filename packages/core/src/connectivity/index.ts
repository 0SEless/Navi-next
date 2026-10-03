/**
 * Canonical Connectivity Semantics
 *
 * Single source of truth for authored road connectivity intent.
 * @see ./connectivity-semantics.ts for the contract definition.
 */
export {
  CONNECTIVITY_CONTRACT_VERSION,
  extractConnectivitySemantics,
  areRoadsConnected,
  areRoadsSeparated,
  hasSeparatedCrossingAtPosition,
  junctionsForRoad,
  CONNECTIVITY_POSITION_TOLERANCE_METERS,
} from './connectivity-semantics'

export type {
  ConnectivitySemantics,
  CanonicalJunction,
  CanonicalSeparatedCrossing,
  SeparatedCrossingLike,
} from './connectivity-semantics'
