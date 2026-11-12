/** Minimal JSON helpers shared by the Host validator and the browser renderer. */
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
export function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    if (Object.prototype.toString.call(value) !== '[object Object]')
        return false;
    const proto = Object.getPrototypeOf(value);
    if (proto === null)
        return true;
    const ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') ? proto.constructor : undefined;
    return typeof ctor === 'function' && ctor.name === 'Object';
}
export function isJsonValue(value, seen = new Set()) {
    if (value === null)
        return true;
    const t = typeof value;
    if (t === 'string' || t === 'boolean')
        return true;
    if (t === 'number')
        return Number.isFinite(value);
    if (t !== 'object')
        return false;
    if (seen.has(value))
        return false;
    seen.add(value);
    try {
        if (Array.isArray(value))
            return value.every((entry) => isJsonValue(entry, seen));
        if (!isPlainObject(value))
            return false;
        return Object.values(value).every((entry) => isJsonValue(entry, seen));
    }
    finally {
        seen.delete(value);
    }
}
/** JSON Pointer decoding: RFC 6901 `~1` -> `/`, `~0` -> `~`. */
function decodeSegment(segment) {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}
/** JSON Pointer encoding, the inverse of {@link decodeSegment}. */
function encodeSegment(segment) {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}
/** Split a JSON Pointer into decoded segments; `''` and `'/'` mean the root. */
export function pointerSegments(pointer) {
    if (pointer === '' || pointer === '/')
        return [];
    if (!pointer.startsWith('/'))
        return [pointer];
    return pointer.slice(1).split('/').map(decodeSegment);
}
export function pointerJoin(base, segment) {
    const prefix = base === '/' ? '' : base;
    return `${prefix}/${encodeSegment(String(segment))}`;
}
/** Segments that must never address an object's prototype chain. */
const DANGEROUS_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
/**
 * Read a pointer from a value.
 * @returns `{ found, value }` so a stored `undefined`/`null` is distinguishable.
 */
export function pointerGet(root, pointer) {
    let cursor = root;
    for (const segment of pointerSegments(pointer)) {
        if (DANGEROUS_SEGMENTS.has(segment))
            return { found: false, value: undefined };
        if (Array.isArray(cursor)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= cursor.length)
                return { found: false, value: undefined };
            cursor = cursor[index];
            continue;
        }
        if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
            return { found: false, value: undefined };
        }
        cursor = cursor[segment];
    }
    return { found: true, value: cursor };
}
/**
 * Copy-on-write pointer assignment. A `null` value deletes the addressed key,
 * matching the protocol's "set value explicitly to null to delete" rule.
 */
export function pointerSet(root, pointer, value) {
    const segments = pointerSegments(pointer);
    if (segments.length === 0)
        return value;
    const write = (container, index) => {
        const segment = segments[index];
        if (DANGEROUS_SEGMENTS.has(segment))
            return container;
        const isLast = index === segments.length - 1;
        if (Array.isArray(container)) {
            const array = container.slice();
            const position = Number(segment);
            if (!Number.isInteger(position) || position < 0)
                return container;
            if (isLast) {
                if (value === null)
                    array.splice(position, 1);
                else
                    array[position] = value;
                return array;
            }
            const existing = array[position];
            array[position] = write(isPlainObject(existing) || Array.isArray(existing) ? existing : {}, index + 1);
            return array;
        }
        const record = isPlainObject(container) ? { ...container } : {};
        if (isLast) {
            if (value === null)
                delete record[segment];
            else
                record[segment] = value;
            return record;
        }
        const existing = record[segment];
        record[segment] = write(isPlainObject(existing) || Array.isArray(existing) ? existing : {}, index + 1);
        return record;
    };
    const result = write(root, 0);
    return result;
}
