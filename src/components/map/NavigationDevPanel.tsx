'use client'

import type {
  NavigationDevMoveDirection,
  NavigationDevSimulationState,
} from '@/lib/navigation-dev-simulation'

export interface NavigationDevPanelProps {
  simulation: NavigationDevSimulationState
  onHeadingChange: (heading: number) => void
  onMove: (direction: NavigationDevMoveDirection) => void
}

const MOVE_BUTTONS: Array<{ direction: NavigationDevMoveDirection; label: string }> = [
  { direction: 'north', label: 'N' },
  { direction: 'south', label: 'S' },
  { direction: 'east', label: 'E' },
  { direction: 'west', label: 'W' },
]

/** Small, explicitly labelled development-only input surface. */
export default function NavigationDevPanel({
  simulation,
  onHeadingChange,
  onMove,
}: NavigationDevPanelProps) {
  return (
    <aside
      className="pointer-events-auto absolute bottom-4 left-4 z-20 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-amber-400/60 bg-slate-950/90 p-3 text-xs text-white shadow-xl backdrop-blur"
      data-testid="navigation-dev-panel"
      aria-label="Development navigation simulator"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold uppercase tracking-wide text-amber-300">DEV simulated location</p>
        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">DEV ONLY</span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-slate-300">
        {simulation.position.lat.toFixed(8)}, {simulation.position.lng.toFixed(8)}
      </p>
      <label className="mt-3 block font-medium text-slate-200" htmlFor="navigation-dev-heading">
        Heading: {simulation.heading}°
      </label>
      <input
        id="navigation-dev-heading"
        className="mt-1 h-6 w-full accent-amber-300"
        type="range"
        min="0"
        max="359"
        step="1"
        value={simulation.heading}
        aria-label="Simulated heading"
        onChange={(event) => onHeadingChange(Number(event.target.value))}
      />
      <div className="mt-2 flex items-center justify-between gap-1" aria-label="Simulated movement">
        {MOVE_BUTTONS.map(({ direction, label }) => (
          <button
            key={direction}
            type="button"
            className="min-h-8 min-w-10 rounded-lg border border-slate-600 px-2 font-semibold text-slate-100 hover:border-amber-300 hover:text-amber-200"
            aria-label={`Move ${direction}`}
            title={`Move ${direction}`}
            onClick={() => onMove(direction)}
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  )
}
