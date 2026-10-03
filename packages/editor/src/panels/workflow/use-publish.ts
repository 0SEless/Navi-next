import { useSyncExternalStore, useCallback, useRef } from 'react'
import { useEditor } from '../../context'
import type { PublishService } from '../../services/publish-service'
import type { PublishStore, PublishSnapshot, PublishState } from '../../services/publish-store'

const EMPTY_SNAPSHOT: PublishSnapshot = Object.freeze({
  version: 0,
  publishState: 'idle',
  publishResult: null,
  publishError: null,
  currentStageStartedAt: 0,
  lastPublishedRevision: 0,
  lastPublishedAt: 0,
})

const noopSubscribe = (_: () => void) => () => {}

const FALLBACK_STORE: PublishStore = {
  subscribe: noopSubscribe,
  getSnapshot: () => EMPTY_SNAPSHOT,
} as unknown as PublishStore

const FALLBACK_SERVICE: PublishService = {
  publish: async () => {},
  isPublishing: () => false,
} as unknown as PublishService

export function usePublish(): {
  snapshot: PublishSnapshot
  publish: () => Promise<void>
  isPublishing: boolean
  stateColor: string
} {
  const { services } = useEditor()

  const publishStore = services.get('publishStore') ?? FALLBACK_STORE
  const publishService = services.get('publish') ?? FALLBACK_SERVICE

  const snapshot = useSyncExternalStore(
    (cb: () => void) => publishStore.subscribe(cb),
    () => publishStore.getSnapshot(),
    () => publishStore.getSnapshot(),
  )

  const svcRef = useRef(publishService)
  svcRef.current = publishService

  const publish = useCallback(async () => {
    await svcRef.current.publish()
  }, [])

  const isPublishing = snapshot.publishState !== 'idle' && snapshot.publishState !== 'success' && snapshot.publishState !== 'error'

  const stateColor = stateToColor(snapshot.publishState)

  return { snapshot, publish, isPublishing, stateColor }
}

function stateToColor(state: PublishState): string {
  switch (state) {
    case 'success': return '#16a34a'
    case 'error': return '#dc2626'
    case 'preparing':
    case 'validating':
    case 'compiling':
    case 'uploading': return '#2563eb'
    default: return '#9ca3af'
  }
}
