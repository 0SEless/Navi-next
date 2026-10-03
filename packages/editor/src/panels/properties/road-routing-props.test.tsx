import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Road, RoadDirection, RoadRoutingFeature, RoadSlope } from '@navi/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorProvider } from '../../context'
import type { EditorContext } from '../../context'
import { RoadProperties } from './road-props'

afterEach(cleanup)

function createRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'rd-1',
    name: 'Main Road',
    polyline: { points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }] },
    width: 6,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
    ...overrides,
  }
}

function renderWithDispatcher(road: Road, execute = vi.fn(), emit = vi.fn()) {
  const services = {
    get: (name: string) => {
      if (name === 'dispatcher') return { execute }
      if (name === 'eventBus') return { emit }
      return undefined
    },
  }
  return { execute, emit, ...render(
    <EditorProvider context={{
      document: {} as EditorContext['document'],
      services: services as unknown as EditorContext['services'],
    }}>
      <RoadProperties road={road} />
    </EditorProvider>,
  ) }
}

describe('RoadProperties routing and terrain authoring', () => {
  it('renders legacy effective defaults and complete option sets without mutation or dispatch', () => {
    const road = createRoad()
    const before = structuredClone(road)
    const { execute } = renderWithDispatcher(road)

    expect(screen.getByText('Routing & Terrain')).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Path feature' })).toHaveValue('normal')
    expect(screen.getByRole('combobox', { name: 'Slope' })).toHaveValue('level')
    expect(screen.getByRole('combobox', { name: 'Direction' })).toHaveValue('both')
    expect(screen.getByRole('checkbox', { name: 'Walkable' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Wheelchair accessible' })).toHaveValue('unknown')
    expect(Array.from(
      (screen.getByRole('combobox', { name: 'Path feature' }) as HTMLSelectElement).options,
      option => option.value,
    )).toEqual(['normal', 'stairs', 'ramp', 'bridge'])
    expect(Array.from(
      (screen.getByRole('combobox', { name: 'Slope' }) as HTMLSelectElement).options,
      option => option.value,
    )).toEqual(['level', 'gentle', 'moderate', 'steep'])
    expect(Array.from(
      (screen.getByRole('combobox', { name: 'Direction' }) as HTMLSelectElement).options,
      option => option.value,
    )).toEqual(['both', 'forward', 'reverse'])
    expect(Array.from(
      (screen.getByRole('combobox', { name: 'Wheelchair accessible' }) as HTMLSelectElement).options,
      option => option.value,
    )).toEqual(['unknown', 'accessible', 'not-accessible'])
    expect(execute).not.toHaveBeenCalled()
    expect(road).toEqual(before)
    expect(road).not.toHaveProperty('routing')
  })

  it.each<RoadRoutingFeature>(['normal', 'stairs', 'ramp', 'bridge'])(
    'authors the %s path feature',
    (feature) => {
      const initialFeature = feature === 'normal' ? 'stairs' : 'normal'
      const { execute } = renderWithDispatcher(createRoad({ routing: { feature: initialFeature } }))

      fireEvent.change(screen.getByRole('combobox', { name: 'Path feature' }), {
        target: { value: feature },
      })

      expect(execute).toHaveBeenLastCalledWith({
        id: 'entity.update',
        label: 'Edit Road',
        payload: { entityId: 'rd-1', changes: { routing: { feature } } },
      })
    },
  )

  it.each<RoadSlope>(['level', 'gentle', 'moderate', 'steep'])(
    'authors the %s slope',
    (slope) => {
      const initialSlope = slope === 'level' ? 'steep' : 'level'
      const { execute } = renderWithDispatcher(createRoad({ routing: { slope: initialSlope } }))

      fireEvent.change(screen.getByRole('combobox', { name: 'Slope' }), {
        target: { value: slope },
      })

      expect(execute).toHaveBeenLastCalledWith({
        id: 'entity.update',
        label: 'Edit Road',
        payload: { entityId: 'rd-1', changes: { routing: { slope } } },
      })
    },
  )

  it.each<RoadDirection>(['both', 'forward', 'reverse'])(
    'authors the %s direction',
    (direction) => {
      const initialDirection = direction === 'both' ? 'forward' : 'both'
      const { execute } = renderWithDispatcher(createRoad({ routing: { direction: initialDirection } }))

      fireEvent.change(screen.getByRole('combobox', { name: 'Direction' }), {
        target: { value: direction },
      })

      expect(execute).toHaveBeenLastCalledWith({
        id: 'entity.update',
        label: 'Edit Road',
        payload: { entityId: 'rd-1', changes: { routing: { direction } } },
      })
    },
  )

  it.each([true, false])('authors walkable=%s', (walkable) => {
    const { execute } = renderWithDispatcher(createRoad({ routing: { walkable: !walkable } }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Walkable' }))
    expect(execute).toHaveBeenLastCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { routing: { walkable } } },
    })
  })

  it.each([
    ['unknown', undefined],
    ['accessible', true],
    ['not-accessible', false],
  ] as const)('authors the %s wheelchair state', (selection, wheelchairAccessible) => {
    const initial = selection === 'unknown' ? true : undefined
    const { execute } = renderWithDispatcher(
      createRoad({ routing: { feature: 'ramp', wheelchairAccessible: initial } }),
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Wheelchair accessible' }), {
      target: { value: selection },
    })

    const expectedRouting = wheelchairAccessible === undefined
      ? { feature: 'ramp' }
      : { feature: 'ramp', wheelchairAccessible }
    expect(execute).toHaveBeenLastCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { routing: expectedRouting } },
    })
  })

  it('keeps elevation controls compact but always accessible', () => {
    renderWithDispatcher(createRoad())
    expect(screen.queryByRole('textbox', { name: 'Start elevation (m)' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show elevation details' }))
    expect(screen.getByRole('textbox', { name: 'Start elevation (m)' })).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'End elevation (m)' })).toBeDefined()
  })

  it.each([
    ['Start elevation (m)', '12.5', { startElevationMeters: 12.5 }],
    ['End elevation (m)', '-4.25', { endElevationMeters: -4.25 }],
    ['Start elevation (m)', '0', { startElevationMeters: 0 }],
  ] as const)('authors valid optional elevation through %s', (label, raw, expectedRouting) => {
    const { execute } = renderWithDispatcher(createRoad({ routing: { slope: 'gentle' } }))
    fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: raw } })
    expect(execute).toHaveBeenLastCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: {
        entityId: 'rd-1',
        changes: { routing: { slope: 'gentle', ...expectedRouting } },
      },
    })
  })

  it('clears elevation to undefined without interpreting empty as zero', () => {
    const { execute } = renderWithDispatcher(createRoad({
      routing: { slope: 'gentle', startElevationMeters: 0, endElevationMeters: 5 },
    }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Start elevation (m)' }), {
      target: { value: '' },
    })
    expect(execute).toHaveBeenLastCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: {
        entityId: 'rd-1',
        changes: { routing: { slope: 'gentle', endElevationMeters: 5 } },
      },
    })
  })

  it.each(['not a number', 'NaN', 'Infinity', '-Infinity'])(
    'keeps invalid elevation text local and never dispatches %s',
    (raw) => {
      const { execute } = renderWithDispatcher(createRoad({ routing: { slope: 'moderate' } }))
      const input = screen.getByRole('textbox', { name: 'Start elevation (m)' })
      fireEvent.change(input, { target: { value: raw } })
      expect(input).toHaveValue(raw)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a finite number or leave blank.')
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('preserves every unrelated routing field when one field changes', () => {
    const road = createRoad({
      routing: {
        feature: 'stairs',
        slope: 'moderate',
        direction: 'reverse',
        startElevationMeters: 40,
        endElevationMeters: 46,
        walkable: false,
        wheelchairAccessible: false,
      },
    })
    const { execute } = renderWithDispatcher(road)
    fireEvent.change(screen.getByRole('combobox', { name: 'Slope' }), {
      target: { value: 'steep' },
    })
    expect(execute).toHaveBeenLastCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: {
        entityId: 'rd-1',
        changes: {
          routing: {
            feature: 'stairs',
            slope: 'steep',
            direction: 'reverse',
            startElevationMeters: 40,
            endElevationMeters: 46,
            walkable: false,
            wheelchairAccessible: false,
          },
        },
      },
    })
  })

  it('uses Phase 1 semantics for signed elevation change and grade display', () => {
    renderWithDispatcher(createRoad({ routing: { startElevationMeters: 5, endElevationMeters: 15 } }))
    expect(screen.getByText('+10 m')).toBeDefined()
    expect(screen.getByText('9.0%')).toBeDefined()
  })

  it('shows neutral derived values for incomplete elevation', () => {
    renderWithDispatcher(createRoad({ routing: { startElevationMeters: 5 } }))
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('warns when explicit Level conflicts with a nonzero elevation grade', () => {
    renderWithDispatcher(createRoad({
      routing: { slope: 'level', startElevationMeters: 5, endElevationMeters: 15 },
    }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Elevation suggests a grade, but Slope is set to Level. Manual slope controls routing cost.',
    )
  })

  it('does not warn for an implicit default Level or equal elevations', () => {
    const first = renderWithDispatcher(createRoad({
      routing: { startElevationMeters: 5, endElevationMeters: 15 },
    }))
    expect(screen.queryByRole('status')).toBeNull()
    first.unmount()

    renderWithDispatcher(createRoad({
      routing: { slope: 'level', startElevationMeters: 5, endElevationMeters: 5 },
    }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows neutral grade rather than a non-finite value for zero-length roads', () => {
    renderWithDispatcher(createRoad({
      polyline: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }] },
      routing: { startElevationMeters: 5, endElevationMeters: 15 },
    }))
    expect(screen.getByText('+10 m')).toBeDefined()
    expect(screen.getByText('—')).toBeDefined()
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull()
  })

  it('retains existing Surface and Type update behavior', () => {
    const { execute } = renderWithDispatcher(createRoad())
    const comboboxes = screen.getAllByRole('combobox')
    const surface = comboboxes.find(element => element.querySelector('option[value="gravel"]'))
    const type = comboboxes.find(element => element.querySelector('option[value="service"]'))
    fireEvent.change(surface!, { target: { value: 'gravel' } })
    fireEvent.change(type!, { target: { value: 'service' } })
    expect(execute).toHaveBeenNthCalledWith(1, {
      id: 'entity.update', label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { surface: 'gravel' } },
    })
    expect(execute).toHaveBeenNthCalledWith(2, {
      id: 'entity.update', label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { type: 'service' } },
    })
  })

  it('does not alter geometry or invoke geometry editing from a routing edit', () => {
    const road = createRoad({ routing: { feature: 'normal' } })
    const before = structuredClone(road)
    const { execute, emit } = renderWithDispatcher(road)
    fireEvent.change(screen.getByRole('combobox', { name: 'Path feature' }), {
      target: { value: 'bridge' },
    })
    const changes = execute.mock.calls[0][0].payload.changes
    expect(changes).toEqual({ routing: { feature: 'bridge' } })
    expect(changes).not.toHaveProperty('polyline')
    expect(changes).not.toHaveProperty('id')
    expect(emit).not.toHaveBeenCalled()
    expect(road).toEqual(before)
  })
})
