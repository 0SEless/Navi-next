import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PolygonRenderer } from '../PolygonRenderer'
import { PolygonEngine } from '../PolygonEngine'

describe('PolygonRenderer', () => {
  it('renders an SVG polygon', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
    const { container } = render(
      <PolygonRenderer
        polygon={poly}
        style={{ fillColor: '#ff0000', strokeColor: '#000000', strokeWidth: 2, opacity: 0.5 }}
      />,
    )
    const svgPolygon = container.querySelector('polygon')
    expect(svgPolygon).toBeTruthy()
    expect(svgPolygon!.getAttribute('fill')).toBe('#ff0000')
    expect(svgPolygon!.getAttribute('stroke-width')).toBe('2')
  })

  it('renders empty state for null polygon', () => {
    const { container } = render(
      <PolygonRenderer
        polygon={null as any}
        style={{ fillColor: '#000', strokeColor: '#000', strokeWidth: 1, opacity: 1 }}
      />,
    )
    expect(container.querySelector('polygon')).toBeFalsy()
  })
})
