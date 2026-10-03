export interface FloorSegment {
  /** The floor shared by every node in the segment (undefined when unknown). */
  floor: number | undefined
  /** Node ids in path order. */
  nodes: string[]
}

/**
 * Split a route path into maximal consecutive runs of nodes that share a
 * floor (a new segment starts wherever the floor changes). Nodes without
 * floor info extend the current segment — they connect the run geometrically —
 * and backfill the next known floor when they lead the path. A path with no
 * floor info at all collapses to a single segment.
 */
export function splitRouteByFloor(
  path: string[],
  floorOf: (nodeId: string) => number | undefined,
): FloorSegment[] {
  const segments: FloorSegment[] = []
  for (const nodeId of path) {
    const floor = floorOf(nodeId)
    const last = segments[segments.length - 1]
    if (last && (last.floor === undefined || floor === undefined || floor === last.floor)) {
      last.nodes.push(nodeId)
      if (last.floor === undefined && floor !== undefined) last.floor = floor
    } else {
      segments.push({ floor, nodes: [nodeId] })
    }
  }
  return segments
}
