/**
 * SVG charts for the extension catalog: BarChart, LineChart, PieChart, Plot.
 *
 * Hand-rolled SVG instead of a chart library keeps the single-file client
 * bundle small, avoids a runtime CDN, and inherits the theme (text uses
 * `currentColor`, grids use `--dsw-alias-border-l1`). Every chart also exposes
 * an accessible summary, because an SVG is otherwise opaque to screen readers.
 *
 * Interactivity is local by design: hovering highlights the data point, shows a
 * tooltip, and clicking a legend entry toggles that series. None of it sends a
 * message or touches the model.
 */
import * as React from 'react'
import { h } from './h.js'
import type { A2UIComponent } from '../shared/validate.js'
import { compileExpression, type CompiledExpression } from '../shared/expression.js'
import { anyValue, numberList, numberValue, text, type Scope } from './context.js'
import { isDataBinding, isFunctionCall } from '../shared/schema.js'

const VIEW_WIDTH = 640
const PAD = { top: 18, right: 16, bottom: 30, left: 46 }
const TOOLTIP_FONT = 10.5
const CHAR_WIDTH = 6.1

/** Series colour: an authored safe colour, else the theme-independent palette. */
function seriesColor(index: number, override: unknown): string {
  if (typeof override === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/u.test(override)) return override
  return `var(--a2ui-c${(index % 8) + 1})`
}

function formatTick(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (abs >= 1_000) return `${trim(value / 1_000)}k`
  return trim(value)
}

function trim(value: number): string {
  if (!Number.isFinite(value)) return '–'
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100
  return String(rounded)
}

interface Scale {
  min: number
  max: number
  ticks: number[]
}

function niceScale(values: number[], forcedMin?: number, forcedMax?: number, tickCount = 4): Scale {
  const finite = values.filter((value) => Number.isFinite(value))
  let min = forcedMin ?? (finite.length > 0 ? Math.min(...finite) : 0)
  let max = forcedMax ?? (finite.length > 0 ? Math.max(...finite) : 1)
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = 1
  if (min === max) {
    const padding = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1
    min -= padding
    max += padding
  }
  if (forcedMin === undefined && min > 0 && min / max < 0.6) min = 0
  const span = max - min
  const rawStep = span / Math.max(1, tickCount)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude
  const niceMin = forcedMin === undefined ? Math.floor(min / step) * step : min
  const niceMax = forcedMax === undefined ? Math.ceil(max / step) * step : max
  const ticks: number[] = []
  for (let tick = niceMin; tick <= niceMax + step / 2 && ticks.length < 12; tick += step) ticks.push(Number(tick.toFixed(10)))
  return { min: niceMin, max: niceMax, ticks }
}

interface SeriesData {
  label: string
  values: number[]
  color: string
}

function readSeries(scope: Scope, component: A2UIComponent): SeriesData[] {
  const raw = Array.isArray(component.series) ? component.series.slice(0, 8) : []
  return raw.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>
    return {
      label: record.label === undefined ? `${scope.view.t('series')} ${index + 1}` : text(scope, record.label),
      values: numberList(scope, record.values),
      color: seriesColor(index, record.color),
    }
  })
}

interface LegendProps {
  series: Array<{ label: string; color: string }>
  hidden?: ReadonlySet<number>
  onToggle?: (index: number) => void
  /** Entries beyond the legend cap, reported instead of silently dropped. */
  more?: number
}

function legend(props: LegendProps): ReturnType<typeof h> | null {
  const { series, hidden, onToggle, more } = props
  if (series.length <= 1) return null
  return h(
    'div',
    { className: 'a2ui-legend' },
    ...series.map((entry, index) => {
      const off = hidden?.has(index) === true
      return h(
        'button',
        {
          key: `l${index}`,
          type: 'button',
          className: `a2ui-legend-item${off ? ' a2ui-legend-off' : ''}`,
          'aria-pressed': !off,
          title: entry.label,
          onClick: onToggle === undefined ? undefined : () => onToggle(index),
          style: onToggle === undefined ? { cursor: 'default' } : undefined,
        },
        h('span', { className: 'a2ui-legend-swatch', style: { background: entry.color } }),
        entry.label,
      )
    }),
    more !== undefined && more > 0 ? h('span', { className: 'a2ui-legend-more' }, `+${more}`) : null,
  )
}

function caption(scope: Scope, component: A2UIComponent): ReturnType<typeof h> | null {
  if (component.caption === undefined) return null
  return h('p', { className: 'a2ui-caption' }, text(scope, component.caption))
}

function emptyChart(scope: Scope, component: A2UIComponent, message: string): ReturnType<typeof h> {
  return h('div', { className: 'a2ui-chart-wrap' }, caption(scope, component), h('p', { className: 'a2ui-caption' }, message))
}

function chartHeight(component: A2UIComponent, fallback: number): number {
  const height = component.height
  return typeof height === 'number' && Number.isFinite(height) ? Math.max(120, Math.min(560, height)) : fallback
}

function axisSummary(scope: Scope, categories: string[], series: SeriesData[]): string {
  const parts = series.map((entry) => {
    const min = entry.values.length > 0 ? Math.min(...entry.values) : 0
    const max = entry.values.length > 0 ? Math.max(...entry.values) : 0
    return `${entry.label}: ${scope.view.t('total')} ${trim(entry.values.reduce((sum, value) => sum + value, 0))} (min ${trim(min)}, max ${trim(max)})`
  })
  return `${categories.join(', ')}. ${parts.join('. ')}`
}

/** Tooltip box drawn inside the SVG so it can never overflow the card. */
function tooltipLines(
  x: number,
  y: number,
  width: number,
  height: number,
  lines: string[],
  align: 'start' | 'end' = 'start',
): ReturnType<typeof h> {
  const left = align === 'start' ? Math.min(x, VIEW_WIDTH - width - 4) : Math.max(4, x - width)
  return h(
    'g',
    { className: 'a2ui-tip', pointerEvents: 'none' },
    h('rect', { x: left, y, width, height, rx: 6, fill: 'var(--dsw-alias-bg-overlay)', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1, opacity: 0.98 }),
    ...lines.map((line, index) =>
      h(
        'text',
        { key: `t${index}`, x: left + 8, y: y + 14 + index * 13, fontSize: TOOLTIP_FONT, fill: 'var(--dsw-alias-label-primary)' },
        line,
      ),
    ),
  )
}

function textWidth(lines: string[]): number {
  return Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH + 16
}

/**
 * Domain a bar chart needs so the baseline is visible.
 *
 * A positive-only series starts at 0, a negative-only one ends at 0, and a
 * mixed one contains 0 naturally. An explicit `yMin`/`yMax` wins; if both force
 * the same value the domain is left automatic so the scale cannot collapse.
 */
export function barDomain(values: number[], forcedMin?: number, forcedMax?: number): { min?: number; max?: number } {
  const finite = values.filter((value) => Number.isFinite(value))
  const dataMin = finite.length > 0 ? Math.min(...finite) : 0
  const dataMax = finite.length > 0 ? Math.max(...finite) : 0
  let min = forcedMin ?? (dataMin >= 0 ? 0 : undefined)
  let max = forcedMax ?? (dataMax <= 0 ? 0 : undefined)
  if (min !== undefined && max !== undefined && min === max) {
    min = undefined
    max = undefined
  }
  return { min, max }
}

/**
 * Split sampled points into drawable runs.
 *
 * A curve that leaves the plotted domain (`1/x`, `tan`, an asymptote) is broken
 * instead of being connected across the gap, which would draw a false straight
 * line through a discontinuity.
 */
export function splitPlotSegments(
  points: Array<{ x: number; y: number }>,
  min: number,
  max: number,
): Array<Array<{ x: number; y: number }>> {
  const segments: Array<Array<{ x: number; y: number }>> = []
  let current: Array<{ x: number; y: number }> = []
  for (const point of points) {
    if (!Number.isFinite(point.y) || point.y < min || point.y > max) {
      if (current.length > 0) segments.push(current)
      current = []
      continue
    }
    current.push(point)
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/** `BarChart` */
export function renderBarChart(scope: Scope, component: A2UIComponent): ReturnType<typeof h> {
  const view = scope.view
  const categories = Array.isArray(component.categories) ? (component.categories as unknown[]).map((entry) => text(scope, entry)) : []
  const allSeries = readSeries(scope, component)
  const [hidden, setHidden] = React.useState<Set<number>>(() => new Set())
  const [hover, setHover] = React.useState<{ series: number; category: number } | null>(null)
  const series = allSeries.filter((_, index) => !hidden.has(index))
  const horizontal = component.horizontal === true
  const stacked = component.stacked === true
  const suffix = component.valueSuffix === undefined ? '' : text(scope, component.valueSuffix)
  const all = series.flatMap((entry) => entry.values)
  if (categories.length === 0 || series.length === 0 || all.length === 0) return emptyChart(scope, component, view.t('chartEmpty'))

  const toggle = (index: number): void => {
    setHidden((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next.size >= allSeries.length ? new Set() : next
    })
  }

  const height = chartHeight(component, horizontal ? Math.max(160, categories.length * 26 + PAD.top + PAD.bottom) : 240)
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right
  const plotHeight = height - PAD.top - PAD.bottom

  // Bar charts must show their baseline: a positive-only series starts at 0, a
  // negative-only one ends at 0, and a mixed one contains 0. An explicit yMin /
  // yMax wins, and the plot is clamped to that domain.
  const domain = barDomain(all, numberValue(scope, component.yMin), numberValue(scope, component.yMax))
  let scale: Scale
  if (stacked && !horizontal) {
    const stackMin: number[] = []
    const stackMax: number[] = []
    categories.forEach((_, index) => {
      let up = 0
      let down = 0
      for (const entry of series) {
        const value = entry.values[index] ?? 0
        if (value >= 0) up += value
        else down += value
      }
      stackMax.push(up)
      stackMin.push(down)
    })
    scale = niceScale([...stackMax, ...stackMin], domain.min, domain.max)
  } else {
    scale = niceScale(all, domain.min, domain.max)
  }
  const span = scale.max - scale.min || 1
  const clamp = (value: number): number => Math.max(scale.min, Math.min(scale.max, value))
  const valueToY = (value: number): number => PAD.top + plotHeight - ((clamp(value) - scale.min) / span) * plotHeight
  const valueToX = (value: number): number => PAD.left + ((clamp(value) - scale.min) / span) * plotWidth
  const band = horizontal ? plotHeight / Math.max(1, categories.length) : plotWidth / Math.max(1, categories.length)
  const groupWidth = band * 0.68
  const barWidth = stacked || horizontal ? groupWidth : groupWidth / Math.max(1, series.length)

  const grid = h(
    'g',
    { className: 'a2ui-grid' },
    ...scale.ticks.map((tick, index) =>
      horizontal
        ? h(
            'g',
            { key: `g${index}` },
            h('line', { x1: valueToX(tick), x2: valueToX(tick), y1: PAD.top, y2: PAD.top + plotHeight }),
            h('text', { x: valueToX(tick), y: height - 10, textAnchor: 'middle', fontSize: 10 }, formatTick(tick)),
          )
        : h(
            'g',
            { key: `g${index}` },
            h('line', { x1: PAD.left, x2: PAD.left + plotWidth, y1: valueToY(tick), y2: valueToY(tick) }),
            h('text', { x: PAD.left - 6, y: valueToY(tick) + 3.5, textAnchor: 'end', fontSize: 10 }, formatTick(tick)),
          ),
    ),
  )

  const bars: Array<ReturnType<typeof h>> = []
  categories.forEach((category, categoryIndex) => {
    const center = PAD.left + band * categoryIndex + band / 2
    if (stacked && !horizontal) {
      let up = 0
      let down = 0
      series.forEach((entry, seriesIndex) => {
        const value = entry.values[categoryIndex] ?? 0
        const base = value >= 0 ? up : down
        const top = base + value
        const yBase = valueToY(base)
        const yTop = valueToY(top)
        const isHover = hover?.category === categoryIndex
        bars.push(
          h('rect', {
            key: `b${categoryIndex}-${seriesIndex}`,
            x: center - barWidth / 2,
            y: Math.min(yBase, yTop),
            width: barWidth,
            height: Math.max(0.5, Math.abs(yBase - yTop)),
            rx: 2,
            fill: entry.color,
            opacity: hover === null || isHover ? 1 : 0.42,
            onMouseEnter: () => setHover({ series: seriesIndex, category: categoryIndex }),
            onMouseLeave: () => setHover(null),
            style: { transition: 'opacity .12s ease' },
          }),
        )
        if (value >= 0) up = top
        else down = top
      })
    } else if (horizontal) {
      const baseline = valueToX(0)
      series.forEach((entry, seriesIndex) => {
        const value = entry.values[categoryIndex] ?? 0
        const end = valueToX(value)
        const isHover = hover?.category === categoryIndex
        bars.push(
          h('rect', {
            key: `b${categoryIndex}-${seriesIndex}`,
            x: Math.min(baseline, end),
            y: PAD.top + band * categoryIndex + (band - groupWidth) / 2 + seriesIndex * (groupWidth / Math.max(1, series.length)),
            width: Math.max(0.5, Math.abs(end - baseline)),
            height: (groupWidth / Math.max(1, series.length)) * 0.86,
            rx: 2,
            fill: entry.color,
            opacity: hover === null || isHover ? 1 : 0.42,
            onMouseEnter: () => setHover({ series: seriesIndex, category: categoryIndex }),
            onMouseLeave: () => setHover(null),
            style: { transition: 'opacity .12s ease' },
          }),
        )
      })
    } else {
      series.forEach((entry, seriesIndex) => {
        const value = entry.values[categoryIndex] ?? 0
        const zero = valueToY(0)
        const y = valueToY(value)
        const isHover = hover !== null && hover.category === categoryIndex && hover.series === seriesIndex
        bars.push(
          h('rect', {
            key: `b${categoryIndex}-${seriesIndex}`,
            x: center - groupWidth / 2 + seriesIndex * barWidth,
            y: Math.min(y, zero),
            width: Math.max(1, barWidth * 0.88),
            height: Math.max(0.5, Math.abs(zero - y)),
            rx: 2,
            fill: entry.color,
            opacity: hover === null || isHover ? 1 : 0.5,
            stroke: isHover ? 'var(--dsw-alias-label-primary)' : 'none',
            strokeWidth: isHover ? 1 : 0,
            onMouseEnter: () => setHover({ series: seriesIndex, category: categoryIndex }),
            onMouseLeave: () => setHover(null),
            style: { transition: 'opacity .12s ease' },
          }),
        )
      })
    }
    if (categories.length <= 14) {
      bars.push(
        h(
          'text',
          {
            key: `x${categoryIndex}`,
            x: horizontal ? PAD.left - 6 : center,
            y: horizontal ? PAD.top + band * categoryIndex + band / 2 + 3.5 : height - 10,
            textAnchor: horizontal ? 'end' : 'middle',
            fontSize: 10,
            fill: 'currentColor',
            opacity: hover === null || hover.category === categoryIndex ? 0.85 : 0.45,
          },
          category.length > 14 ? `${category.slice(0, 13)}…` : category,
        ),
      )
    }
  })

  let tooltip: ReturnType<typeof h> | null = null
  if (hover !== null) {
    const entry = series[hover.series]
    const value = entry?.values[hover.category]
    const label = categories[hover.category] ?? ''
    if (entry !== undefined && value !== undefined) {
      const lines = [label, `${entry.label}: ${trim(value)}${suffix === '' ? '' : ` ${suffix}`}`]
      const width = textWidth(lines)
      const x = horizontal ? valueToX(value) : PAD.left + band * hover.category + band / 2
      tooltip = tooltipLines(x, PAD.top + 2, width, 14 + lines.length * 13, lines, 'start')
    }
  }

  return h(
    'div',
    { className: 'a2ui-chart-wrap' },
    caption(scope, component),
    h(
      'svg',
      {
        className: 'a2ui-chart-svg a2ui-axis',
        viewBox: `0 0 ${VIEW_WIDTH} ${height}`,
        role: 'img',
        'aria-label': axisSummary(scope, categories, series),
        style: { maxHeight: `${height}px` },
      },
      grid,
      ...bars,
      tooltip,
    ),
    legend({ series: allSeries, hidden, onToggle: toggle }),
    suffix === '' ? null : h('p', { className: 'a2ui-caption' }, `(${suffix})`),
  )
}

/** `LineChart` */
export function renderLineChart(scope: Scope, component: A2UIComponent): ReturnType<typeof h> {
  const view = scope.view
  const categories = Array.isArray(component.categories) ? (component.categories as unknown[]).map((entry) => text(scope, entry)) : []
  const allSeries = readSeries(scope, component)
  const [hidden, setHidden] = React.useState<Set<number>>(() => new Set())
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null)
  const series = allSeries.filter((_, index) => !hidden.has(index))
  const area = component.area === true
  const smooth = component.curve === 'smooth'
  const showPoints = component.showPoints !== false
  const all = series.flatMap((entry) => entry.values)
  if (series.length === 0 || all.length === 0) return emptyChart(scope, component, view.t('chartEmpty'))
  const height = chartHeight(component, 240)
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right
  const plotHeight = height - PAD.top - PAD.bottom
  const scale = niceScale(all, numberValue(scope, component.yMin), numberValue(scope, component.yMax))
  const count = Math.max(1, ...series.map((entry) => entry.values.length), categories.length)
  const xAt = (index: number): number => PAD.left + (count === 1 ? plotWidth / 2 : (plotWidth * index) / (count - 1))
  const yAt = (value: number): number => PAD.top + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight

  const toggle = (index: number): void => {
    setHidden((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next.size >= allSeries.length ? new Set() : next
    })
  }

  const pathFor = (values: number[]): string => {
    if (values.length === 0) return ''
    if (!smooth || values.length < 3) {
      return values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`).join(' ')
    }
    let path = `M${xAt(0).toFixed(2)},${yAt(values[0] as number).toFixed(2)}`
    for (let index = 0; index < values.length - 1; index += 1) {
      const x0 = xAt(Math.max(0, index - 1))
      const y0 = yAt(values[Math.max(0, index - 1)] as number)
      const x1 = xAt(index)
      const y1 = yAt(values[index] as number)
      const x2 = xAt(index + 1)
      const y2 = yAt(values[index + 1] as number)
      const x3 = xAt(Math.min(values.length - 1, index + 2))
      const y3 = yAt(values[Math.min(values.length - 1, index + 2)] as number)
      const c1x = x1 + (x2 - x0) / 6
      const c1y = y1 + (y2 - y0) / 6
      const c2x = x2 - (x3 - x1) / 6
      const c2y = y2 - (y3 - y1) / 6
      path += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`
    }
    return path
  }

  const grid = h(
    'g',
    { className: 'a2ui-grid' },
    ...scale.ticks.map((tick, index) =>
      h(
        'g',
        { key: `g${index}` },
        h('line', { x1: PAD.left, x2: PAD.left + plotWidth, y1: yAt(tick), y2: yAt(tick) }),
        h('text', { x: PAD.left - 6, y: yAt(tick) + 3.5, textAnchor: 'end', fontSize: 10 }, formatTick(tick)),
      ),
    ),
  )

  const marks: Array<ReturnType<typeof h>> = []
  series.forEach((entry, seriesIndex) => {
    const line = pathFor(entry.values)
    if (area) {
      const base = yAt(scale.min)
      marks.push(
        h('path', {
          key: `a${seriesIndex}`,
          d: `${line} L${xAt(entry.values.length - 1).toFixed(2)},${base} L${xAt(0).toFixed(2)},${base} Z`,
          fill: entry.color,
          opacity: 0.14,
        }),
      )
    }
    marks.push(h('path', { key: `p${seriesIndex}`, d: line, fill: 'none', stroke: entry.color, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }))
    if (showPoints) {
      entry.values.forEach((value, index) => {
        const active = hoverIndex === index
        marks.push(
          h('circle', {
            key: `c${seriesIndex}-${index}`,
            cx: xAt(index),
            cy: yAt(value),
            r: active ? 4.2 : 2.6,
            fill: entry.color,
            stroke: active ? 'var(--dsw-alias-bg-layer-2)' : 'none',
            strokeWidth: active ? 1.2 : 0,
            style: { transition: 'r .1s ease' },
          }),
        )
      })
    }
  })

  const labelStep = Math.max(1, Math.ceil(Math.max(categories.length, count) / 8))
  categories.forEach((category, index) => {
    if (index % labelStep !== 0) return
    marks.push(
      h(
        'text',
        {
          key: `x${index}`,
          x: xAt(index),
          y: height - 10,
          textAnchor: 'middle',
          fontSize: 10,
          fill: 'currentColor',
          opacity: hoverIndex === null || hoverIndex === index ? 0.8 : 0.45,
        },
        category.length > 12 ? `${category.slice(0, 11)}…` : category,
      ),
    )
  })

  // Hover bands: one invisible column per category, so a tooltip lists every
  // series at that x without needing per-point hit areas.
  const bands: Array<ReturnType<typeof h>> = []
  const bandWidth = count === 1 ? plotWidth : plotWidth / (count - 1)
  for (let index = 0; index < count; index += 1) {
    const x = xAt(index) - bandWidth / 2
    bands.push(
      h('rect', {
        key: `h${index}`,
        x: Math.max(PAD.left, x),
        y: PAD.top,
        width: Math.max(6, Math.min(bandWidth, PAD.left + plotWidth - x)),
        height: plotHeight,
        fill: 'transparent',
        onMouseEnter: () => setHoverIndex(index),
        onMouseLeave: () => setHoverIndex(null),
      }),
    )
  }

  let tooltip: ReturnType<typeof h> | null = null
  if (hoverIndex !== null) {
    const lines = [categories[hoverIndex] ?? `#${hoverIndex + 1}`]
    series.forEach((entry) => {
      const value = entry.values[hoverIndex]
      if (value !== undefined) lines.push(`${entry.label}: ${trim(value)}`)
    })
    if (lines.length > 1) {
      const x = xAt(hoverIndex)
      const width = textWidth(lines)
      tooltip = tooltipLines(x, PAD.top + 2, width, 14 + lines.length * 13, lines, x > VIEW_WIDTH / 2 ? 'end' : 'start')
    }
  }

  const guide =
    hoverIndex === null
      ? null
      : h('line', {
          x1: xAt(hoverIndex),
          x2: xAt(hoverIndex),
          y1: PAD.top,
          y2: PAD.top + plotHeight,
          stroke: 'var(--dsw-alias-label-secondary)',
          strokeWidth: 1,
          strokeDasharray: '3 3',
          opacity: 0.6,
        })

  const yLabel = component.yLabel === undefined ? '' : text(scope, component.yLabel)
  return h(
    'div',
    { className: 'a2ui-chart-wrap' },
    caption(scope, component),
    h(
      'svg',
      {
        className: 'a2ui-chart-svg a2ui-axis',
        viewBox: `0 0 ${VIEW_WIDTH} ${height}`,
        role: 'img',
        'aria-label': axisSummary(scope, categories, series),
        style: { maxHeight: `${height}px` },
      },
      grid,
      guide,
      yLabel === '' ? null : h('text', { x: PAD.left, y: 11, fontSize: 10, fill: 'currentColor', opacity: 0.7 }, yLabel),
      ...marks,
      ...bands,
      tooltip,
    ),
    legend({ series: allSeries, hidden, onToggle: toggle }),
  )
}

/** `PieChart` */
export function renderPieChart(scope: Scope, component: A2UIComponent): ReturnType<typeof h> {
  const view = scope.view
  const raw = Array.isArray(component.slices) ? component.slices : []
  const [hover, setHover] = React.useState<number | null>(null)
  const allSlices = raw.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>
    return {
      label: record.label === undefined ? `#${index + 1}` : text(scope, record.label),
      value: Math.max(0, numberValue(scope, record.value) ?? 0),
      color: seriesColor(index, record.color),
    }
  })
  const total = allSlices.reduce((sum, slice) => sum + slice.value, 0)
  if (total <= 0) return emptyChart(scope, component, view.t('chartEmpty'))
  const maxVisibleSlices = 40
  const slices = allSlices.slice(0, maxVisibleSlices)
  const remaining = allSlices.length - slices.length
  if (remaining > 0) {
    slices.push({
      label: `${view.t('otherSlices')} (${remaining})`,
      value: allSlices.slice(maxVisibleSlices).reduce((sum, slice) => sum + slice.value, 0),
      color: seriesColor(maxVisibleSlices, undefined),
    })
  }
  const summary = remaining > 0
    ? h('p', { className: 'a2ui-chart-note' }, `${view.t('groupedSlices')}: ${remaining}`)
    : null
  const height = chartHeight(component, 220)
  const radius = Math.min(height, VIEW_WIDTH / 2) / 2 - 14
  const cx = VIEW_WIDTH / 4
  const cy = height / 2
  const donut = component.donut === true
  const suffix = component.valueSuffix === undefined ? '' : text(scope, component.valueSuffix)
  let angle = -Math.PI / 2
  const arcs = slices.map((slice, index) => {
    const sweep = (slice.value / total) * Math.PI * 2
    const start = angle
    const end = angle + sweep
    angle = end
    const large = sweep > Math.PI ? 1 : 0
    const mid = start + sweep / 2
    const lift = hover === index ? 7 : 0
    const x1 = cx + radius * Math.cos(start)
    const y1 = cy + radius * Math.sin(start)
    const x2 = cx + radius * Math.cos(end)
    const y2 = cy + radius * Math.sin(end)
    const path =
      sweep >= Math.PI * 2 - 1e-6
        ? `M${cx},${cy - radius} A${radius},${radius} 0 1 1 ${cx - 0.01},${cy - radius} Z`
        : `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`
    return { path, color: slice.color, index, mid, lift, share: slice.value / total }
  })

  const active = hover === null ? null : slices[hover]
  const centerTop = donut || active !== null
  const centerText =
    active === null
      ? [`${view.t('total')} ${trim(total)}`]
      : [active.label, `${trim(active.value)}${suffix === '' ? '' : ` ${suffix}`}`, `${Math.round((active.value / total) * 100)}%`]

  return h(
    'div',
    { className: 'a2ui-chart-wrap' },
    caption(scope, component),
    summary,
    h(
      'svg',
      {
        className: 'a2ui-chart-svg',
        viewBox: `0 0 ${VIEW_WIDTH} ${height}`,
        role: 'img',
        'aria-label': slices.map((slice) => `${slice.label} ${trim(slice.value)}`).join(', '),
        style: { maxHeight: `${height}px` },
      },
      ...arcs.map((arc) =>
        h('path', {
          key: `s${arc.index}`,
          d: arc.path,
          fill: arc.color,
          opacity: hover === null || hover === arc.index ? 0.94 : 0.45,
          style: {
            transform: arc.lift === 0 ? undefined : `translate(${(Math.cos(arc.mid) * arc.lift).toFixed(2)}px, ${(Math.sin(arc.mid) * arc.lift).toFixed(2)}px)`,
            transition: 'transform .14s ease, opacity .14s ease',
          },
          onMouseEnter: () => setHover(arc.index),
          onMouseLeave: () => setHover(null),
        }),
      ),
      donut ? h('circle', { cx, cy, r: radius * 0.58, fill: 'var(--dsw-alias-bg-layer-2)', pointerEvents: 'none' }) : null,
      centerTop && !donut
        ? h('circle', { cx, cy, r: radius * 0.46, fill: 'var(--dsw-alias-bg-layer-2)', opacity: 0.9, pointerEvents: 'none' })
        : null,
      centerTop
        ? h(
            'g',
            { pointerEvents: 'none' },
            ...centerText.map((line, index) =>
              h(
                'text',
                {
                  key: `c${index}`,
                  x: cx,
                  y: cy + (index - (centerText.length - 1) / 2) * 15 + 4,
                  textAnchor: 'middle',
                  fontSize: index === 0 ? 11 : 13,
                  fontWeight: index === 0 ? 500 : 600,
                  fill: 'var(--dsw-alias-label-primary)',
                },
                line,
              ),
            ),
          )
        : null,
      ...slices.slice(0, 10).map((slice, index) => {
        const isActive = hover === index
        return h(
          'g',
          {
            key: `t${index}`,
            onMouseEnter: () => setHover(index),
            onMouseLeave: () => setHover(null),
            style: { cursor: 'default' },
          },
          h('rect', { x: VIEW_WIDTH / 2 + 4, y: 16 + index * 19, width: 9, height: 9, rx: 2, fill: slice.color, opacity: hover === null || isActive ? 1 : 0.45 }),
          h(
            'text',
            {
              x: VIEW_WIDTH / 2 + 19,
              y: 24.5 + index * 19,
              fontSize: 11,
              fill: 'var(--dsw-alias-label-primary)',
              opacity: hover === null || isActive ? 1 : 0.5,
              textDecoration: isActive ? 'underline' : undefined,
            },
            `${slice.label.length > 18 ? `${slice.label.slice(0, 17)}…` : slice.label} · ${Math.round((slice.value / total) * 100)}%`,
          ),
        )
      }),
      // Legend cap: say how many entries are not listed instead of dropping them.
      slices.length > 10
        ? h(
            'text',
            { x: VIEW_WIDTH / 2 + 19, y: 24.5 + 10 * 19, fontSize: 11, fill: 'currentColor', opacity: 0.7 },
            `+${slices.length - 10}`,
          )
        : null,
    ),
  )
}

/** `Plot` */
export function renderPlot(scope: Scope, component: A2UIComponent): ReturnType<typeof h> {
  const view = scope.view
  const xMin = numberValue(scope, component.xMin) ?? -10
  const xMax = numberValue(scope, component.xMax) ?? 10
  if (!(xMax > xMin)) return emptyChart(scope, component, view.t('plotInvalid'))
  const samples = Math.max(8, Math.min(1200, numberValue(scope, component.samples) ?? 240))
  const variablesRaw = component.variables
  const variables: Record<string, number> = {}
  // `variables` may be an object of per-variable bindings, or one binding that
  // resolves to the whole coefficient object (`{"@path": "/coefficients"}`).
  if (isDataBinding(variablesRaw) || isFunctionCall(variablesRaw)) {
    const resolved = anyValue(scope, variablesRaw)
    if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
      for (const [key, value] of Object.entries(resolved as Record<string, unknown>)) {
        const numeric = typeof value === 'number' ? value : Number(value)
        if (Number.isFinite(numeric)) variables[key] = numeric
      }
    }
  } else if (variablesRaw !== undefined && variablesRaw !== null && typeof variablesRaw === 'object') {
    for (const [key, value] of Object.entries(variablesRaw as Record<string, unknown>)) {
      const resolved = numberValue(scope, value)
      if (resolved !== undefined) variables[key] = resolved
    }
  }
  const plots = (Array.isArray(component.plots) ? component.plots.slice(0, 8) : []).map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>
    const kind = record.kind === 'scatter' ? 'scatter' : 'function'
    let compiled: CompiledExpression | undefined
    let error = ''
    if (kind === 'function') {
      const expression = typeof record.expression === 'string' ? record.expression : ''
      try {
        compiled = compileExpression(expression)
      } catch (cause) {
        error = cause instanceof Error ? cause.message : view.t('plotInvalid')
      }
    }
    const points = Array.isArray(record.points)
      ? (record.points as Array<Record<string, unknown>>)
          .map((point) => ({ x: numberValue(scope, point.x), y: numberValue(scope, point.y) }))
          .filter((point): point is { x: number; y: number } => point.x !== undefined && point.y !== undefined)
      : []
    return {
      label: record.label === undefined ? `${view.t('series')} ${index + 1}` : text(scope, record.label),
      kind,
      compiled,
      error,
      points,
      color: seriesColor(index, record.color),
    }
  })
  if (plots.length === 0 || plots.every((plot) => plot.error !== '' && plot.points.length === 0)) {
    return emptyChart(scope, component, plots.find((plot) => plot.error !== '')?.error || view.t('plotInvalid'))
  }

  const step = (xMax - xMin) / (samples - 1)
  const lines = plots.map((plot) => {
    if (plot.kind === 'scatter' || plot.compiled === undefined) return { ...plot, samples: [] as Array<{ x: number; y: number }> }
    const points: Array<{ x: number; y: number }> = []
    for (let index = 0; index < samples; index += 1) {
      const x = xMin + step * index
      const y = plot.compiled.evaluate({ ...variables, x })
      if (Number.isFinite(y)) points.push({ x, y })
    }
    return { ...plot, samples: points }
  })
  const allY = [...lines.flatMap((line) => [...line.samples.map((point) => point.y), ...line.points.map((point) => point.y)])]
  const scale = niceScale(allY, numberValue(scope, component.yMin), numberValue(scope, component.yMax))
  const height = chartHeight(component, 250)
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right
  const plotHeight = height - PAD.top - PAD.bottom
  const xAt = (x: number): number => PAD.left + ((x - xMin) / (xMax - xMin)) * plotWidth
  const yAt = (y: number): number => PAD.top + plotHeight - ((y - scale.min) / (scale.max - scale.min)) * plotHeight

  const xTicks: number[] = []
  for (let index = 0; index <= 4; index += 1) xTicks.push(xMin + ((xMax - xMin) * index) / 4)

  const grid = h(
    'g',
    { className: 'a2ui-grid' },
    ...scale.ticks.map((tick, index) =>
      h(
        'g',
        { key: `gy${index}` },
        h('line', { x1: PAD.left, x2: PAD.left + plotWidth, y1: yAt(tick), y2: yAt(tick) }),
        h('text', { x: PAD.left - 6, y: yAt(tick) + 3.5, textAnchor: 'end', fontSize: 10 }, formatTick(tick)),
      ),
    ),
    ...xTicks.map((tick, index) =>
      h(
        'g',
        { key: `gx${index}` },
        h('line', { x1: xAt(tick), x2: xAt(tick), y1: PAD.top, y2: PAD.top + plotHeight }),
        h('text', { x: xAt(tick), y: height - 10, textAnchor: 'middle', fontSize: 10 }, formatTick(tick)),
      ),
    ),
  )

  const marks: Array<ReturnType<typeof h>> = []
  if (scale.min <= 0 && scale.max >= 0) {
    marks.push(h('line', { x1: PAD.left, x2: PAD.left + plotWidth, y1: yAt(0), y2: yAt(0), stroke: 'currentColor', opacity: 0.35, strokeWidth: 1 }))
  }
  lines.forEach((line, index) => {
    // A curve that leaves the plotted domain (1/x, tan, a vertical asymptote) is
    // broken rather than connected across the gap.
    const segments = splitPlotSegments(line.samples, scale.min, scale.max)

    segments.forEach((segment, segmentIndex) => {
      if (segment.length === 1) {
        marks.push(h('circle', { key: `fx${index}-${segmentIndex}`, cx: xAt(segment[0].x), cy: yAt(segment[0].y), r: 2, fill: line.color }))
        return
      }
      marks.push(
        h('path', {
          key: `f${index}-${segmentIndex}`,
          d: segment.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${xAt(point.x).toFixed(2)},${yAt(point.y).toFixed(2)}`).join(' '),
          fill: 'none',
          stroke: line.color,
          strokeWidth: 2,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }),
      )
    })
    line.points.forEach((point, pointIndex) => {
      marks.push(h('circle', { key: `s${index}-${pointIndex}`, cx: xAt(point.x), cy: yAt(point.y), r: 3, fill: line.color }))
    })
  })

  const invalid = plots.filter((plot) => plot.error !== '')
  return h(
    'div',
    { className: 'a2ui-chart-wrap' },
    caption(scope, component),
    h(
      'svg',
      {
        className: 'a2ui-chart-svg a2ui-axis',
        viewBox: `0 0 ${VIEW_WIDTH} ${height}`,
        role: 'img',
        'aria-label': `${component.xLabel === undefined ? 'x' : text(scope, component.xLabel)} ${trim(xMin)}..${trim(xMax)}`,
        style: { maxHeight: `${height}px` },
      },
      grid,
      ...marks,
    ),
    invalid.length === 0
      ? null
      : h('p', { className: 'a2ui-error' }, ...invalid.map((plot, index) => h('span', { key: `e${index}` }, `${plot.label}: ${plot.error}; `))),
    legend({ series: lines }),
  )
}

export function BarChartView(props: { component: A2UIComponent; scope: Scope }): ReturnType<typeof h> {
  return renderBarChart(props.scope, props.component)
}

export function LineChartView(props: { component: A2UIComponent; scope: Scope }): ReturnType<typeof h> {
  return renderLineChart(props.scope, props.component)
}

export function PieChartView(props: { component: A2UIComponent; scope: Scope }): ReturnType<typeof h> {
  return renderPieChart(props.scope, props.component)
}

export function PlotView(props: { component: A2UIComponent; scope: Scope }): ReturnType<typeof h> {
  return renderPlot(props.scope, props.component)
}
