export interface PersistStudioGraphOptions {
  syncDocument: () => void
  saveGraph: () => Promise<void>
  bumpRenderVersion: () => void
}

/**
 * Keep editor document projection, graph persistence, and redraw in one
 * awaited operation. A rejected graph-store save deliberately skips the
 * redraw and reaches WorkflowService as a failed persistence promise.
 */
export async function persistStudioGraph({
  syncDocument,
  saveGraph,
  bumpRenderVersion,
}: PersistStudioGraphOptions): Promise<void> {
  syncDocument()
  await saveGraph()
  bumpRenderVersion()
}
