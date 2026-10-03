import { render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { CampusMap } from '@/types/campus-map'
import { StudioCaptureReviewer } from '../components/StudioCaptureReviewer'

const mocks = vi.hoisted(() => ({
  getRemoteSession: vi.fn(),
  reviewerProps: null as Record<string, unknown> | null,
  dispatcher: { executeBatch: vi.fn() },
}))

vi.mock('@navi/editor', () => ({
  useEditor: () => ({
    document: { roads: [], metadata: { campusId: 'campus-1' } },
    services: { get: () => mocks.dispatcher },
  }),
}))

vi.mock('@/features/capture-sync/context', () => ({
  useCaptureSync: () => ({ getRemoteSession: mocks.getRemoteSession }),
}))

vi.mock('../components/CaptureReviewer', () => ({
  CaptureReviewer: (props: Record<string, unknown>) => {
    mocks.reviewerProps = props
    return (
      <div
        data-back-label={String(props.backLabel ?? '')}
        data-has-remote-loader={String(Boolean(props.getRemoteSession))}
        data-remote-campus-id={String(props.remoteCampusId ?? '')}
        data-remote-session-id={String(props.remoteSessionId ?? '')}
        data-testid="capture-reviewer-props"
      />
    )
  },
}))

const campusMap: CampusMap = {
  id: 'campus-1',
  name: 'Demo Campus',
  schoolName: 'Demo School',
  boundary: [],
  center: { lat: 11.8, lng: 122.1 },
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:00:00.000Z',
  stats: { buildings: 0, nodes: 0, edges: 0 },
}

describe('StudioCaptureReviewer remote composition', () => {
  it('passes the requested remote session and provider-neutral loader to the existing Reviewer', () => {
    const Reviewer = StudioCaptureReviewer as unknown as ComponentType<Record<string, unknown>>

    render(<Reviewer campusMap={campusMap} remoteSessionId="remote-session-1" />)

    expect(screen.getByTestId('capture-reviewer-props')).toHaveAttribute('data-remote-session-id', 'remote-session-1')
    expect(screen.getByTestId('capture-reviewer-props')).toHaveAttribute('data-remote-campus-id', 'campus-1')
    expect(screen.getByTestId('capture-reviewer-props')).toHaveAttribute('data-has-remote-loader', 'true')
    expect(screen.getByTestId('capture-reviewer-props')).toHaveAttribute('data-back-label', 'Back to Capture Library')
    expect(mocks.reviewerProps?.getRemoteSession).toBe(mocks.getRemoteSession)
  })
})
