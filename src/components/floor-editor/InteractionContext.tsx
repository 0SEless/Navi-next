'use client'

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import {
  InteractionController,
  type InteractionState,
  getInteractionController,
} from './InteractionController'

// ── Context ─────────────────────────────────────────────────────────────────

interface InteractionContextValue {
  /** Current interaction state */
  state: InteractionState
  /** Status message (empty when idle) */
  statusMessage: string
  /** Enter relationship selection mode */
  enterRelationshipSelection: (
    ownerId: string,
    ownerType: string,
    relationshipType: string,
  ) => void
  /** Cancel current interaction */
  cancel: (reason: 'escape' | 'rightClick' | 'toolSwitch' | 'entitySelect' | 'modeSwitch') => void
}

const InteractionContext = createContext<InteractionContextValue | null>(null)

// ── Provider ────────────────────────────────────────────────────────────────

export function InteractionProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<InteractionController>(getInteractionController())
  const [state, setState] = useState<InteractionState>(controllerRef.current.getState())
  const [statusMessage, setStatusMessage] = useState('')

  // Subscribe to state changes
  useState(() => {
    const unsub = controllerRef.current.onChange((newState) => {
      setState(newState)
      setStatusMessage(controllerRef.current.getStatusMessage())
    })
    return unsub
  })

  const enterRelationshipSelection = useCallback(
    (
      ownerId: string,
      ownerType: string,
      relationshipType: string,
    ) => {
      controllerRef.current.enterRelationshipSelection(
        ownerId,
        ownerType,
        relationshipType,
      )
    },
    [],
  )

  const cancel = useCallback(
    (reason: 'escape' | 'rightClick' | 'toolSwitch' | 'entitySelect' | 'modeSwitch') => {
      controllerRef.current.onCancel({ type: 'cancel', reason })
    },
    [],
  )

  return (
    <InteractionContext.Provider
      value={{
        state,
        statusMessage,
        enterRelationshipSelection,
        cancel,
      }}
    >
      {children}
    </InteractionContext.Provider>
  )
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useInteraction(): InteractionContextValue {
  const ctx = useContext(InteractionContext)
  if (!ctx) {
    throw new Error('useInteraction must be used within InteractionProvider')
  }
  return ctx
}

// ── Export controller for non-React code ─────────────────────────────────────

export { getInteractionController }
