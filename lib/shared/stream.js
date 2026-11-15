/**
 * Progressive fold: render an `a2ui` call while the model is still writing it.
 *
 * The finished-call path is strict — `validateToolArguments` decides, and a
 * single violation turns the whole card into a readable error. That is right for
 * settled data and useless for data still arriving, so this module is the
 * deliberately different sibling used *only* while a call is being prepared. It
 * still refuses everything the settled path refuses; it only relaxes the parts
 * that *cannot* be decided yet:
 *
 * - Graph completeness is not required: a component whose children have not been
 *   written renders a placeholder. That is expected in a stream, not a defect.
 * - Everything decidable for a *closed* component is decided — shape, catalog and
 *   every property, plus the aliases the official examples use — through the same
 *   validator functions the settled path calls. A component that is complete but
 *   illegal is dropped, so a preview can never draw what the real result rejects.
 * - A surface without its `root`, or whose root was dropped, is not drawn at all.
 * - The render budget is applied per surface *and* per call, in the same units and
 *   against the same `LIMITS` the settled path uses, before any element exists.
 *
 * Nothing here authorises anything: the streaming card is non-interactive, and
 * the settled call replaces it with the validated snapshot.
 */
import { PROTOCOL_VERSION, resolveCatalogId } from './catalog.js';
import { estimateExpansion } from './budget.js';
import { isPlainObject } from './json.js';
import { LIMITS } from './limits.js';
import { recoverArguments } from './partial-json.js';
import { applyMessageBatch, checkComponentAlone, } from './validate.js';
const EMPTY = { surfaces: [], components: 0, streaming: false, stopped: false, truncated: false };
function usableId(value) {
    return typeof value === 'string' && value !== '' && value.length <= LIMITS.maxIdLength;
}
/**
 * Keep the components that are complete *and* legal on their own.
 *
 * @param value the recovered `components` array.
 * @param catalogId the catalog the enclosing surface declares.
 */
function sanitiseComponents(value, catalogId) {
    if (!Array.isArray(value))
        return { components: [], root: false, dropped: true, overLimit: false };
    if (value.length > LIMITS.maxComponentsPerMessage) {
        // The settled path rejects the whole call at this point, so drawing a
        // truncated version would show something that can never be real.
        return { components: [], root: false, dropped: true, overLimit: true };
    }
    const components = [];
    const seen = new Set();
    let root = false;
    let dropped = false;
    for (const entry of value) {
        const checked = checkComponentAlone(entry, catalogId);
        const component = checked.component;
        if (component === undefined || seen.has(component.id)) {
            // Illegal on its own, or a repeated id (a protocol error in one message).
            // The first declaration wins so the preview stays stable while writing.
            dropped = true;
            continue;
        }
        seen.add(component.id);
        if (component.id === 'root')
            root = true;
        components.push(component);
    }
    return { components, root, dropped, overLimit: false };
}
/**
 * Shape-check one recovered message against the catalog its surface declares.
 *
 * @param value the recovered message.
 * @param catalogs catalog ids learned earlier in this same fold, by surface id.
 */
function sanitiseMessage(value, catalogs) {
    const skip = { root: false, dropped: true };
    if (!isPlainObject(value))
        return skip;
    const create = value.createSurface;
    if (isPlainObject(create)) {
        if (!usableId(create.surfaceId))
            return skip;
        const declared = typeof create.catalogId === 'string' && create.catalogId !== '' ? create.catalogId : undefined;
        const catalogId = resolveCatalogId(declared, undefined);
        if (catalogId === undefined)
            return skip;
        const components = sanitiseComponents(create.components, catalogId);
        if (components.overLimit)
            return skip;
        return {
            message: {
                version: PROTOCOL_VERSION,
                createSurface: {
                    surfaceId: create.surfaceId,
                    catalogId,
                    ...(typeof create.sendDataModel === 'boolean' ? { sendDataModel: create.sendDataModel } : {}),
                    ...(isPlainObject(create.dataModel) ? { dataModel: create.dataModel } : {}),
                    components: components.components,
                },
            },
            root: components.root,
            dropped: components.dropped,
        };
    }
    const update = value.updateComponents;
    if (isPlainObject(update)) {
        if (!usableId(update.surfaceId))
            return skip;
        // An update inherits the catalog of the surface it addresses; without a
        // create in this fold the default catalog is the only assumption available,
        // and it is the one the settled path starts from too.
        const catalogId = catalogs.get(update.surfaceId) ?? resolveCatalogId(undefined, undefined);
        if (catalogId === undefined)
            return skip;
        const components = sanitiseComponents(update.components, catalogId);
        if (components.overLimit)
            return skip;
        return {
            message: { version: PROTOCOL_VERSION, updateComponents: { surfaceId: update.surfaceId, components: components.components } },
            root: false,
            dropped: components.dropped,
        };
    }
    const data = value.updateDataModel;
    if (isPlainObject(data)) {
        if (!usableId(data.surfaceId))
            return skip;
        if (!Object.prototype.hasOwnProperty.call(data, 'value'))
            return skip;
        const path = data.path;
        if (path !== undefined && typeof path !== 'string')
            return skip;
        return {
            message: {
                version: PROTOCOL_VERSION,
                updateDataModel: { surfaceId: data.surfaceId, ...(typeof path === 'string' ? { path } : {}), value: data.value },
            },
            root: false,
            dropped: false,
        };
    }
    const drop = value.deleteSurface;
    if (isPlainObject(drop)) {
        if (!usableId(drop.surfaceId))
            return skip;
        return { message: { version: PROTOCOL_VERSION, deleteSurface: { surfaceId: drop.surfaceId } }, root: false, dropped: false };
    }
    return skip;
}
/**
 * Fold the argument characters received so far into renderable surfaces.
 *
 * @param text argument text of the call being prepared.
 * @returns surfaces that can be drawn now, plus whether to keep listening.
 */
export function foldStreaming(text) {
    const recovered = recoverArguments(text);
    if (recovered.invalid)
        return { ...EMPTY, stopped: true };
    let truncated = recovered.messages.length > LIMITS.maxMessages;
    const catalogs = new Map();
    const messages = [];
    for (const value of recovered.messages.slice(0, LIMITS.maxMessages)) {
        const sanitised = sanitiseMessage(value, catalogs);
        if (sanitised.dropped)
            truncated = true;
        const message = sanitised.message;
        if (message === undefined)
            continue;
        if ('createSurface' in message) {
            const surfaceId = message.createSurface.surfaceId;
            const catalogId = message.createSurface.catalogId;
            // Remember the catalog so a later `updateComponents` in the same fold is
            // checked against the catalog its surface actually declares.
            if (catalogId !== undefined)
                catalogs.set(surfaceId, catalogId);
            if (!sanitised.root) {
                // Declared without a usable root: nothing to draw *yet*. Skip the create
                // so the fold cannot promote an unrelated later update into a card.
                continue;
            }
        }
        messages.push(message);
    }
    if (messages.length === 0)
        return { ...EMPTY, streaming: recovered.open, truncated };
    const folded = applyMessageBatch(new Map(), messages);
    const surfaces = [];
    let components = 0;
    let nodes = 0;
    let dataUnits = 0;
    let created = 0;
    for (const touch of folded.touches) {
        if (touch.deleted)
            continue;
        const state = folded.surfaces.get(touch.surfaceId);
        if (state === undefined)
            continue;
        // Without a declared root there is nothing to place: an empty card would
        // appear and disappear as each component lands.
        if (!state.components.has('root'))
            continue;
        // The same per-surface count the settled path enforces; a preview must not
        // draw a surface that can never become legal.
        if (state.components.size > LIMITS.maxComponentsPerSurface) {
            truncated = true;
            continue;
        }
        if (touch.created) {
            created += 1;
            if (created > LIMITS.maxSurfacesPerCall) {
                truncated = true;
                continue;
            }
        }
        const estimate = estimateExpansion(state);
        if (estimate.reason !== undefined) {
            // Over the per-surface budget: this surface can never become legal.
            truncated = true;
            continue;
        }
        if (nodes + estimate.nodes > LIMITS.maxTotalExpandedNodes || dataUnits + estimate.dataUnits > LIMITS.maxTotalExpandedDataUnits) {
            // The call as a whole is over budget. Keep the surfaces that already fit —
            // a stable, safe snapshot — and let the settled result take over.
            truncated = true;
            break;
        }
        nodes += estimate.nodes;
        dataUnits += estimate.dataUnits;
        surfaces.push(state);
        components += state.components.size;
    }
    return {
        ...(recovered.title === undefined ? {} : { title: recovered.title }),
        surfaces,
        components,
        streaming: recovered.open,
        stopped: false,
        truncated,
    };
}
