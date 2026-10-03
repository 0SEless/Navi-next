'use client'

import { useMemo } from 'react'
import { useEditor } from '@navi/editor'
import { useCaptureSync } from '@/features/capture-sync/context'
import {
  CaptureImportAdapter,
  DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
  type CaptureImportCommand,
  type CaptureImportContext,
  type CaptureImportBatchResult,
  type CaptureReviewerImportHost,
} from '@/features/capture-import/adapter'
import type { CampusMap } from '@/types/campus-map'
import { CaptureReviewer } from './CaptureReviewer'

export function StudioCaptureReviewer({
  campusMap,
  remoteSessionId,
}: {
  campusMap: CampusMap
  remoteSessionId?: string | null
}) {
  const editor = useEditor()
  const { getRemoteSession } = useCaptureSync()
  const dispatcher = editor.services.get('dispatcher')

  const importHost = useMemo<CaptureReviewerImportHost | null>(() => {
    if (!dispatcher) return null

    const executor = {
      executeBatch(commands: CaptureImportCommand[]): CaptureImportBatchResult {
        return dispatcher.executeBatch(commands as Parameters<typeof dispatcher.executeBatch>[0])
      },
    }

    return {
      adapter: new CaptureImportAdapter({ executor }),
      existingRoads: editor.document.roads,
      getContext: (selectedCampusId: string): CaptureImportContext => ({
        authoritativeCampusId: campusMap.id,
        captureCampusId: selectedCampusId || null,
        studioCampusId: editor.document.metadata.campusId,
        roadWidthMeters: DEFAULT_CAPTURE_ROAD_WIDTH_METERS,
      }),
    }
  }, [campusMap.id, dispatcher, editor.document])

  if (!importHost) {
    return <div role="alert" style={{ padding: 20, color: 'var(--navi-text-secondary)', fontSize: 13 }}>The Studio command service is unavailable. Capture import is disabled.</div>
  }

  return (
    <CaptureReviewer
      campusMaps={[campusMap]}
      importHost={importHost}
      remoteSessionId={remoteSessionId}
      remoteCampusId={remoteSessionId ? campusMap.id : undefined}
      getRemoteSession={remoteSessionId ? getRemoteSession : undefined}
      backLabel={remoteSessionId ? 'Back to Capture Library' : undefined}
    />
  )
}
