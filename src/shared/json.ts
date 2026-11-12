/** Minimal JSON helpers shared by the Host validator and the browser renderer. */

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/**
 * Whether a value is a plain JSON object.
 *
 * Realm-tolerant on purpose: a payload may arrive from `JSON.parse`, a `vm`
 * context, an iframe, or a structured-clone boundary, and in each case its
 * prototype is a different `Object.prototype`. Identity against this realm's
 * `Object.prototype` would reject perfectly valid JSON, so the check uses the
 * object tag plus the prototype's constructor name. `Date`, `Map`, `Set`,
 * arrays, class instances and proxies of them are still rejected.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (Object.prototype.toString.call(value) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(value)
  if (proto === null) return true
  const ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') ? (proto as { constructor?: unknown }).constructor : undefined
  return typeof ctor === 'function' && (ctor as { name?: string }).name === 'Object'
}

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'boolean') return true
  if (t === 'number') return Number.isFinite(value as number)
  if (t !== 'object') return false
  if (seen.has(value as object)) return false
  seen.add(value as object)
  try {
    if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, seen))
    if (!isPlainObject(value)) return false
    return Object.values(value).every((entry) => isJsonValue(entry, seen))
  } finally {
    seen.delete(value as object)
  }
}

/** JSON Pointer decoding: RFC 6901 `~1` -> `/`, `~0` -> `~`. */
function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** JSON Pointer encoding, the inverse of {@link decodeSegment}. */
function encodeSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

/** Split a JSON Pointer into decoded segments; `''` and `'/'` mean the root. */
export function pointerSegments(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return []
  if (!pointer.startsWith('/')) return [pointer]
  return pointer.slice(1).split('/').map(decodeSegment)
}

export function pointerJoin(base: string, segment: string | number): string {
  const prefix = base === '/' ? '' : base
  return `${prefix}/${encodeSegment(String(segment))}`
}

/** Segments that must never address an object's prototype chain. */
const DANGEROUS_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Read a pointer from a value.
 * @returns `{ found, value }` so a stored `undefined`/`null` is distinguishable.
 */
export function pointerGet(root: unknown, pointer: string): { found: boolean; value: unknown } {
  let cursor: unknown = root
  for (const segment of pointerSegments(pointer)) {
    if (DANGEROUS_SEGMENTS.has(segment)) return { found: false, value: undefined }
    if (Array.isArray(cursor)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return { found: false, value: undefined }
      cursor = cursor[index]
      continue
    }
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { found: false, value: undefined }
    }
    cursor = cursor[segment]
  }
  return { found: true, value: cursor }
}

/**
 * Copy-on-write pointer assignment. A `null` value deletes the addressed key,
 * matching the protocol's "set value explicitly to null to delete" rule.
 */
export function pointerSet(root: JsonValue, pointer: string, value: JsonValue): JsonValue {
  const segments = pointerSegments(pointer)
  if (segments.length === 0) return value
  const write = (container: JsonValue, index: number): JsonValue => {
    const segment = segments[index] as string
    if (DANGEROUS_SEGMENTS.has(segment)) return container
    const isLast = index === segments.length - 1
    if (Array.isArray(container)) {
      const array = container.slice()
      const position = Number(segment)
      if (!Number.isInteger(position) || position < 0) return container
      if (isLast) {
        if (value === null) array.splice(position, 1)
        else array[position] = value
        return array
      }
      const existing = array[position]
      array[position] = write(isPlainObject(existing) || Array.isArray(existing) ? (existing as JsonValue) : {}, index + 1)
      return array
    }
    const record: Record<string, JsonValue> = isPlainObject(container) ? { ...(container as Record<string, JsonValue>) } : {}
    if (isLast) {
      if (value === null) delete record[segment]
      else record[segment] = value
      return record
    }
    const existing = record[segment]
    record[segment] = write(isPlainObject(existing) || Array.isArray(existing) ? existing : {}, index + 1)
    return record
  }
  const result = write(root, 0)
  return result
}
