/**
 * The A2UI catalogs this plugin understands.
 *
 * `BASIC` mirrors the official v1.0 basic catalog
 * (`https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`, 18
 * component types); `EXTENSION` adds the data-display components the DeepSeek
 * Harness integration needs and that the basic catalog does not define. Both
 * are ordinary A2UI catalogs addressed by `catalogId`, so a payload stays a
 * protocol payload rather than a private format.
 *
 * Every property below was taken from the official v1.0 schemas shipped in
 * `@a2ui/web_core@0.15.0` (`src/catalogs/basic/v1/components/basic_components.js`
 * and `src/v1_0/schema/common-types.js`), not from prose.
 */
import {
  action,
  arr,
  bindingOrCall,
  bool,
  childList,
  childRef,
  dynBool,
  dynNum,
  dynNumList,
  dynStr,
  dynStrList,
  dynValue,
  knownFunctions,
  num,
  obj,
  oneOf,
  str,
  type Check,
} from './schema.js'
import { LIMITS } from './limits.js'

/** The official v1.0 basic catalog id. */
export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'
/** This plugin's extension catalog id (basic components plus data display). */
export const EXTENSION_CATALOG_ID = 'dsh-a2ui/catalog/v1'

export const PROTOCOL_VERSION = '1.0'

/** Which catalog an entry belongs to. */
export type CatalogOrigin = 'basic' | 'extension'

/** How a component declares child references, used for graph validation. */
export type ChildStyle = 'none' | 'single' | 'list' | 'tabs' | 'modal'

export interface ComponentSpec {
  readonly name: string
  readonly origin: CatalogOrigin
  readonly summary: string
  /** Property validators, excluding the common `id`/`component`/`catalogId`/`accessibility`/`metadata`/`weight`. */
  readonly properties: Record<string, Check>
  readonly required: readonly string[]
  readonly childStyle: ChildStyle
  /** Whether the component renders a selectable/editable control (used for a11y hints). */
  readonly interactive?: boolean
}

const weight: Check = num({ min: 0 })

/** `accessibility` block shared by every component. */
export const accessibilityValidator: Check = obj({
  label: dynStr,
  description: dynStr,
  live: str({ enum: ['off', 'polite', 'assertive'] }),
  hidden: dynBool,
})

/** `metadata` block shared by every component. */
export const metadataValidator: Check = obj({ extensions: obj({}, { strict: false }) })

const checks = arr(
  obj({ condition: bindingOrCall, message: str() }, { required: ['condition'] }),
  { max: LIMITS.maxChecks },
)

const justifyEnum = ['start', 'center', 'end', 'stretch', 'spaceAround', 'spaceBetween', 'spaceEvenly'] as const
const alignEnum = ['start', 'center', 'end', 'stretch'] as const

/* ------------------------------------------------------------------ */
/* Official basic catalog                                              */
/* ------------------------------------------------------------------ */

const BASIC_COMPONENTS: readonly ComponentSpec[] = [
  {
    name: 'Text',
    origin: 'basic',
    summary: 'A paragraph or caption. Supports **bold**, *italic* and `code` inline Markdown.',
    properties: {
      text: dynStr,
      variant: str({ enum: ['caption', 'body'] }),
      weight,
    },
    required: ['text'],
    childStyle: 'none',
  },
  {
    name: 'Image',
    origin: 'basic',
    summary: 'An image from an https URL or a data:image URI.',
    properties: {
      url: dynStr,
      description: dynStr,
      fit: str({ enum: ['contain', 'cover', 'fill', 'none', 'scaleDown'] }),
      variant: str({ enum: ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'] }),
      weight,
    },
    required: ['url'],
    childStyle: 'none',
  },
  {
    name: 'Icon',
    origin: 'basic',
    summary: 'One glyph from the catalog icon set, a named SVG path, or a bound icon object.',
    properties: {
      name: oneOf([str(), obj({ svgPath: dynStr }), dynStr]),
      weight,
    },
    required: ['name'],
    childStyle: 'none',
  },
  {
    name: 'Video',
    origin: 'basic',
    summary: 'A video player for an https URL.',
    properties: { url: dynStr, posterUrl: dynStr, weight },
    required: ['url'],
    childStyle: 'none',
  },
  {
    name: 'AudioPlayer',
    origin: 'basic',
    summary: 'An audio player for an https URL.',
    properties: { url: dynStr, description: dynStr, weight },
    required: ['url'],
    childStyle: 'none',
  },
  {
    name: 'Row',
    origin: 'basic',
    summary: 'Horizontal layout of children.',
    properties: {
      children: childList,
      justify: str({ enum: justifyEnum }),
      align: str({ enum: alignEnum }),
      weight,
    },
    required: ['children'],
    childStyle: 'list',
  },
  {
    name: 'Column',
    origin: 'basic',
    summary: 'Vertical layout of children.',
    properties: {
      children: childList,
      justify: str({ enum: justifyEnum }),
      align: str({ enum: alignEnum }),
      weight,
    },
    required: ['children'],
    childStyle: 'list',
  },
  {
    name: 'List',
    origin: 'basic',
    summary: 'A vertical or horizontal list of children.',
    properties: {
      children: childList,
      direction: str({ enum: ['vertical', 'horizontal'] }),
      align: str({ enum: alignEnum }),
      weight,
    },
    required: ['children'],
    childStyle: 'list',
  },
  {
    name: 'Card',
    origin: 'basic',
    summary: 'A raised container around one child.',
    properties: { child: childRef, weight },
    required: ['child'],
    childStyle: 'single',
  },
  {
    name: 'Tabs',
    origin: 'basic',
    summary: 'Tabbed pages, each with a title and one child.',
    properties: {
      tabs: arr(obj({ title: dynStr, child: childRef }, { required: ['title', 'child'] }), { min: 1, max: LIMITS.maxTabs }),
      weight,
    },
    required: ['tabs'],
    childStyle: 'tabs',
  },
  {
    name: 'Modal',
    origin: 'basic',
    summary: 'A trigger component that opens a dialog containing another component.',
    properties: { trigger: childRef, content: childRef, weight },
    required: ['trigger', 'content'],
    childStyle: 'modal',
  },
  {
    name: 'Divider',
    origin: 'basic',
    summary: 'A horizontal or vertical rule.',
    properties: { axis: str({ enum: ['horizontal', 'vertical'] }), weight },
    required: [],
    childStyle: 'none',
  },
  {
    name: 'Button',
    origin: 'basic',
    summary: 'A labelled button. `action.event` sends an action to the agent; `action.functionCall` runs locally.',
    properties: {
      child: childRef,
      variant: str({ enum: ['default', 'primary', 'borderless'] }),
      action,
      checks,
      weight,
    },
    required: ['child', 'action'],
    childStyle: 'single',
    interactive: true,
  },
  {
    name: 'TextField',
    origin: 'basic',
    summary: 'A single- or multi-line text input, optionally bound to the data model.',
    properties: {
      label: dynStr,
      value: dynStr,
      placeholder: dynStr,
      variant: str({ enum: ['longText', 'number', 'shortText', 'obscured'] }),
      checks,
      weight,
    },
    required: ['label'],
    childStyle: 'none',
    interactive: true,
  },
  {
    name: 'CheckBox',
    origin: 'basic',
    summary: 'A boolean checkbox.',
    properties: { label: dynStr, value: dynBool, checks, weight },
    required: ['label', 'value'],
    childStyle: 'none',
    interactive: true,
  },
  {
    name: 'ChoicePicker',
    origin: 'basic',
    summary: 'A single- or multiple-choice selector; `value` is a string list.',
    properties: {
      label: dynStr,
      variant: str({ enum: ['multipleSelection', 'mutuallyExclusive'] }),
      options: arr(obj({ label: dynStr, value: str() }, { required: ['label', 'value'] }), { min: 1, max: LIMITS.maxOptions }),
      value: dynStrList,
      displayStyle: str({ enum: ['checkbox', 'chips'] }),
      filterable: bool,
      checks,
      weight,
    },
    required: ['options', 'value'],
    childStyle: 'none',
    interactive: true,
  },
  {
    name: 'Slider',
    origin: 'basic',
    summary: 'A numeric slider. Bind `value` to the data model to drive live updates.',
    properties: {
      label: dynStr,
      min: num(),
      max: num(),
      value: dynNum,
      steps: num({ min: 1, integer: true }),
      checks,
      weight,
    },
    required: ['max', 'value'],
    childStyle: 'none',
    interactive: true,
  },
  {
    name: 'DateTimeInput',
    origin: 'basic',
    summary: 'A date and/or time input holding an ISO 8601 string.',
    properties: {
      value: dynStr,
      enableDate: bool,
      enableTime: bool,
      min: dynStr,
      max: dynStr,
      label: dynStr,
      checks,
      weight,
    },
    required: [],
    childStyle: 'none',
    interactive: true,
  },
]

/* ------------------------------------------------------------------ */
/* Extension catalog: data display (not in the basic catalog)          */
/* ------------------------------------------------------------------ */

const colorString: Check = str({ pattern: /^(#[0-9a-fA-F]{3,8}|var\(--[a-zA-Z0-9-]+\)|[a-zA-Z]+)$/ })

const seriesEntry = obj(
  {
    label: dynStr,
    values: dynNumList,
    color: colorString,
  },
  { required: ['values'] },
)

const chartCommon: Record<string, Check> = {
  categories: dynStrList,
  series: arr(seriesEntry, { min: 1, max: LIMITS.maxSeries }),
  caption: dynStr,
  valueSuffix: dynStr,
  yMin: num(),
  yMax: num(),
  height: num({ min: 120, max: 520 }),
  showLegend: bool,
  showValues: bool,
  weight,
}

const EXTENSION_COMPONENTS: readonly ComponentSpec[] = [
  {
    name: 'Table',
    origin: 'extension',
    summary: `A data table with rows keyed by column key. Up to the first ${LIMITS.maxTableRows} rows can be viewed.`,
    properties: {
      columns: arr(
        obj(
          {
            key: str({ minLength: 1 }),
            label: dynStr,
            align: str({ enum: ['start', 'center', 'end'] }),
            width: num({ min: 24, max: 800 }),
            format: str({ enum: ['text', 'number', 'currency', 'percent', 'date'] }),
            decimals: num({ min: 0, max: 6, integer: true }),
            currency: str(),
          },
          { required: ['key', 'label'] },
        ),
        { min: 1, max: 24 },
      ),
      rows: dynValue,
      caption: dynStr,
      striped: bool,
      emptyText: dynStr,
      height: num({ min: 80, max: 640 }),
      weight,
    },
    required: ['columns', 'rows'],
    childStyle: 'none',
  },
  {
    name: 'BarChart',
    origin: 'extension',
    summary: 'A categorical bar chart. Provide one value per category in order.',
    properties: { ...chartCommon, horizontal: bool, stacked: bool },
    required: ['categories', 'series'],
    childStyle: 'none',
  },
  {
    name: 'LineChart',
    origin: 'extension',
    summary: 'A line or area chart. Provide one value per category in order.',
    properties: {
      ...chartCommon,
      area: bool,
      showPoints: bool,
      curve: str({ enum: ['linear', 'smooth'] }),
      yLabel: dynStr,
    },
    required: ['categories', 'series'],
    childStyle: 'none',
  },
  {
    name: 'PieChart',
    origin: 'extension',
    summary: 'A pie or donut chart.',
    properties: {
      slices: arr(
        obj({ label: dynStr, value: dynNum, color: colorString }, { required: ['label', 'value'] }),
        { min: 1, max: LIMITS.maxSeriesPoints },
      ),
      caption: dynStr,
      donut: bool,
      valueSuffix: dynStr,
      height: num({ min: 140, max: 520 }),
      showLegend: bool,
      weight,
    },
    required: ['slices'],
    childStyle: 'none',
  },
  {
    name: 'Stat',
    origin: 'extension',
    summary: 'A KPI tile: label, value, optional unit, delta and trend.',
    properties: {
      label: dynStr,
      value: dynValue,
      unit: dynStr,
      delta: dynStr,
      trend: str({ enum: ['up', 'down', 'flat'] }),
      hint: dynStr,
      weight,
    },
    required: ['label', 'value'],
    childStyle: 'none',
  },
  {
    name: 'Progress',
    origin: 'extension',
    summary: 'A horizontal progress bar.',
    properties: {
      value: dynNum,
      max: num(),
      label: dynStr,
      tone: str({ enum: ['neutral', 'success', 'warning', 'danger'] }),
      showValue: bool,
      weight,
    },
    required: ['value'],
    childStyle: 'none',
  },
  {
    name: 'Plot',
    origin: 'extension',
    summary:
      'A function plot: samples safe arithmetic expressions such as "a*x^2+b*x+c" over [xMin, xMax]. `variables` may be bound to the data model so sliders redraw it locally.',
    properties: {
      plots: arr(
        obj(
          {
            label: dynStr,
            expression: str({ pattern: /^[\x20-\x7e]{1,240}$/ }),
            points: arr(obj({ x: num(), y: num() }, { required: ['x', 'y'] }), { max: LIMITS.maxSeriesPoints }),
            kind: str({ enum: ['function', 'scatter'] }),
            color: colorString,
          },
          {},
        ),
        { min: 1, max: LIMITS.maxSeries },
      ),
      variables: dynValue,
      xMin: num(),
      xMax: num(),
      yMin: num(),
      yMax: num(),
      samples: num({ min: 8, max: 1200, integer: true }),
      xLabel: dynStr,
      yLabel: dynStr,
      caption: dynStr,
      height: num({ min: 140, max: 560 }),
      weight,
    },
    required: ['plots', 'xMin', 'xMax'],
    childStyle: 'none',
  },
  {
    name: 'FramePlayer',
    origin: 'extension',
    summary:
      'A step animation player for precomputed frames (for example every step of a sort). Play, pause, step, reset and speed run locally with no model round trip.',
    properties: {
      frames: arr(
        obj(
          {
            label: dynStr,
            items: arr(
              obj(
                {
                  label: dynStr,
                  value: num(),
                  state: str({ enum: ['idle', 'active', 'compare', 'sorted', 'done'] }),
                },
                { required: ['value'] },
              ),
              { max: LIMITS.maxFrameItems },
            ),
          },
          { required: ['items'] },
        ),
        { min: 1, max: LIMITS.maxFrames },
      ),
      mode: str({ enum: ['bars', 'list'] }),
      speed: num({ min: 80, max: 3000 }),
      caption: dynStr,
      autoplay: bool,
      weight,
    },
    required: ['frames'],
    childStyle: 'none',
    interactive: true,
  },
]

export const COMPONENTS: readonly ComponentSpec[] = [...BASIC_COMPONENTS, ...EXTENSION_COMPONENTS]

export const COMPONENT_BY_NAME: ReadonlyMap<string, ComponentSpec> = new Map(
  COMPONENTS.map((spec) => [spec.name, spec]),
)

/** Names accepted by the extension catalog (it contains both sets). */
export const EXTENSION_COMPONENT_NAMES: ReadonlySet<string> = new Set(
  COMPONENTS.filter((spec) => spec.origin === 'extension').map((spec) => spec.name),
)

export const CATALOG_IDS: ReadonlySet<string> = new Set([BASIC_CATALOG_ID, EXTENSION_CATALOG_ID])

/**
 * Resolve the catalog a surface or component declares.
 * @returns the effective catalog id, or `undefined` when it is unknown.
 */
export function resolveCatalogId(surfaceCatalogId: string | undefined, componentCatalogId?: string): string | undefined {
  const id = componentCatalogId ?? surfaceCatalogId ?? EXTENSION_CATALOG_ID
  if (id === BASIC_CATALOG_ID) return BASIC_CATALOG_ID
  if (id === EXTENSION_CATALOG_ID) return EXTENSION_CATALOG_ID
  return undefined
}

/** Whether `name` is defined by `catalogId`. */
export function componentAllowedIn(catalogId: string, name: string): boolean {
  const spec = COMPONENT_BY_NAME.get(name)
  if (spec === undefined) return false
  if (catalogId === BASIC_CATALOG_ID) return spec.origin === 'basic'
  return true
}

/* ------------------------------------------------------------------ */
/* Function registry                                                   */
/* ------------------------------------------------------------------ */

/** Function names the official basic catalog declares, plus the `@index` system function. */
export const BASIC_FUNCTION_NAMES = [
  'required',
  'regex',
  'length',
  'numeric',
  'email',
  'formatString',
  'formatNumber',
  'formatCurrency',
  'formatDate',
  'pluralize',
  'openUrl',
  'and',
  'or',
  'not',
  '@index',
] as const

for (const name of BASIC_FUNCTION_NAMES) knownFunctions.add(name)

/* ------------------------------------------------------------------ */
/* Model-facing documentation                                          */
/* ------------------------------------------------------------------ */

function describeProperties(spec: ComponentSpec, detail: 'brief' | 'full'): string {
  if (detail === 'brief') return spec.summary
  const required = new Set(spec.required)
  const parts: string[] = []
  for (const key of Object.keys(spec.properties)) {
    if (key === 'weight') continue
    parts.push(`${key}${required.has(key) ? '*' : ''}`)
  }
  return parts.join(', ')
}

/**
 * Compact, model-facing reference for the catalogs.
 * @param detail `brief` lists component names and purpose; `full` adds property names.
 */
export function describeCatalog(detail: 'brief' | 'full' = 'full'): string {
  const lines: string[] = []
  lines.push('A2UI 1.0 catalogs available to this plugin.')
  lines.push(`Default catalogId: ${EXTENSION_CATALOG_ID} (the official basic catalog ${BASIC_CATALOG_ID} is also accepted; it has no Table/Chart/Plot/FramePlayer).`)
  lines.push('')
  lines.push('Components (* = required property). Every component needs "id" and "component". The root component id MUST be "root"; createSurface implicitly wraps it in the canonical Surface container.')
  lines.push('')
  for (const spec of COMPONENTS) {
    const props = describeProperties(spec, detail)
    lines.push(`- ${spec.name}${spec.origin === 'extension' ? ' [extension]' : ''}: ${detail === 'brief' ? spec.summary : props}`)
  }
  if (detail === 'full') {
    lines.push('')
    lines.push('Values: a property that takes DynamicString/DynamicNumber/DynamicBoolean may be a literal, a data binding {"@path":"/json/pointer"}, or a function call {"@call":"name","args":{...}}.')
    lines.push(`Functions: ${BASIC_FUNCTION_NAMES.join(', ')}.`)
    lines.push('Child references: Card/Button take "child"; Row/Column/List take "children" (array of ids, or {"componentId","path"} for a data-model list); Tabs take "tabs":[{"title","child"}]; Modal takes "trigger" and "content".')
    lines.push('Actions: {"event":{"name":"submit","userMessage":"...","context":{"field":{"@path":"/field"}}}} sends an action to you; {"functionCall":{...}} runs locally.')
    lines.push('Layout: positive "weight" lets siblings share available space along their parent flex layout. Use it for widths in Row or horizontal List, and for heights in Column or vertical List.')
    lines.push(`Row/Column "justify" values: ${justifyEnum.join(', ')}. The CSS spellings space-around, space-between and space-evenly are accepted as aliases.`)
    lines.push(`Table rows are objects keyed by column key. The table makes only the first ${LIMITS.maxTableRows} rows available when there are more.`)
    lines.push('BarChart/LineChart: provide one value per category in the same order. Use zero only when the value is actually zero.')
    lines.push('Minimal component examples:')
    lines.push('  Text: {"id":"root","component":"Text","text":"Summary","variant":"body"}')
    lines.push('  Table: {"id":"root","component":"Table","columns":[{"key":"name","label":"Name"}],"rows":[{"name":"Alpha"}]}')
    lines.push('  Weighted Row: [{"id":"root","component":"Row","children":["left","right"]},{"id":"left","component":"Text","text":"Wide","weight":2},{"id":"right","component":"Text","text":"Narrow","weight":1}]')
  }
  return lines.join('\n')
}

/** Every component name, in catalog order. */
export const COMPONENT_NAMES: readonly string[] = COMPONENTS.map((spec) => spec.name)
