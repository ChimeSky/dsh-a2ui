/**
 * `dsh-a2ui` — Host half.
 *
 * Registers the model-facing `a2ui` tool (an A2UI 1.0 message stream authored by
 * the model), a compact `a2ui_catalog` reference tool, and one system-prompt
 * section that teaches when a UI is worth generating. The browser half renders
 * the validated messages; nothing here holds per-session state, so replay is
 * exact and unloading the plugin leaves no residue.
 */
import { describeCatalog } from '../shared/catalog.js';
import { LIMITS } from '../shared/limits.js';
import { isPresentation, PRESENTATIONS, validateToolArguments } from '../shared/validate.js';
const DEFAULT_TOOL_NAME = 'a2ui';
const CATALOG_TOOL_NAME = 'a2ui_catalog';
const DEFAULT_SECTION_ORDER = 120;
/** Max characters of the per-call replay copy stored in the tool result `meta`. */
const META_LIMIT = 96_000;
/** Max violation lines quoted back to the model. */
const MAX_REPORTED_VIOLATIONS = 16;
function textBlock(text) {
    return { type: 'text', text };
}
function formatViolations(errors) {
    const lines = errors.slice(0, MAX_REPORTED_VIOLATIONS).map((error) => `- ${error.path === '' ? 'arguments' : error.path}: ${error.message}`);
    if (errors.length > MAX_REPORTED_VIOLATIONS)
        lines.push(`- …and ${errors.length - MAX_REPORTED_VIOLATIONS} more`);
    return lines.join('\n');
}
function summarizeValue(value) {
    const parts = [];
    if (value.surfaces.length === 0) {
        parts.push('The payload was accepted but no surface changed, so nothing new will render.');
    }
    else {
        for (const surface of value.surfaces) {
            if (surface.deleted)
                parts.push(`Deleted surface "${surface.surfaceId}".`);
            else
                parts.push(`Rendered surface "${surface.surfaceId}" (${surface.components} component${surface.components === 1 ? '' : 's'}).`);
        }
    }
    if (value.warnings.length > 0) {
        parts.push(...value.warnings.map((warning) => `Warning: ${warning}`));
    }
    parts.push(value.note);
    return parts.join('\n');
}
function buildTool(toolName, proactive, catalogTool = true) {
    const parameters = {
        type: 'object',
        properties: {
            presentation: {
                type: 'string',
                enum: PRESENTATIONS,
                description: 'Optional display style. Use "compact" for one chart or a small section within the answer. Put it before "messages" for streaming. The default is "card".',
            },
            messages: {
                type: 'array',
                description: 'A2UI 1.0 messages, applied in order. Each message is `{"version":"1.0","createSurface"|"updateComponents"|"updateDataModel"|"deleteSurface":{...}}`.' + (catalogTool ? ' Call a2ui_catalog for the component reference.' : ''),
                items: { type: 'object' },
            },
            title: {
                type: 'string',
                description: 'Optional short card title shown above the surface (2-6 words). Omit when the surrounding answer already names it.',
            },
        },
        required: ['messages'],
        additionalProperties: false,
    };
    const description = proactive
        ? [
            'Render an interactive A2UI 1.0 interface inside the conversation.',
            'Call this proactively as part of answering — the user does not have to ask for a UI. Whenever your answer contains comparable data (3+ rows), a trend over time, a category breakdown, headline numbers, a parameter space, a step-by-step process, a form to fill, or a decision to make, render it instead of only describing it in prose.',
            'Skip it for single facts, definitions, short explanations, code, logs, and anything a short Markdown answer covers better. Never show the same numbers twice.',
            'The tool validates the payload and returns which surfaces rendered; on a validation error, fix the reported paths and call it again in the same turn.',
            'User actions come back to you as a user message starting with `[A2UI action]`.',
        ].join(' ')
        : [
            'Render an interactive A2UI 1.0 interface inside the conversation.',
            'Use it when the user asks for a visual, or when an answer clearly needs one: data comparison, charts, KPI tiles, a configurable form, parameter exploration, or a step-by-step animation with approval buttons.',
            'Prefer plain Markdown for explanations, prose and simple lists. Do not render a UI for a simple factual answer.',
            'The tool validates the payload and returns which surfaces rendered; on a validation error, fix the reported paths and call it again in the same turn.',
            'User actions come back to you as a user message starting with `[A2UI action]`.',
        ].join(' ');
    return {
        name: toolName,
        description,
        parameters,
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    surfaces: { type: 'array', items: { type: 'object' } },
                    warnings: { type: 'array', items: { type: 'string' } },
                    note: { type: 'string' },
                },
                required: ['ok', 'surfaces', 'warnings', 'note'],
            },
            render: (_args, value) => [textBlock(summarizeValue(value))],
            presentationMeta: (args, value) => {
                // The browser renders from this durable copy so a transcript page that
                // starts after the original `tool/call` event still shows the surface.
                const incoming = (args ?? {});
                const result = value;
                const meta = {
                    kind: 'a2ui',
                    ...(typeof incoming.title === 'string' ? { title: incoming.title } : {}),
                    ...(isPresentation(incoming.presentation) ? { presentation: incoming.presentation } : {}),
                    surfaces: result.surfaces,
                };
                const serializedMessages = safeStringify(incoming.messages);
                if (serializedMessages !== undefined && serializedMessages.length <= META_LIMIT) {
                    meta.messages = incoming.messages;
                }
                else {
                    meta.messagesOmitted = true;
                }
                return meta;
            },
        },
        async execute(args, exec) {
            if (exec.signal.aborted)
                throw new Error('A2UI rendering was cancelled before validation');
            const validation = validateToolArguments(args);
            if (!validation.ok) {
                throw new Error(`A2UI payload rejected (${validation.errors.length} problem${validation.errors.length === 1 ? '' : 's'}):\n${formatViolations(validation.errors)}\nFix these paths and call ${toolName} again.`);
            }
            const value = {
                ok: true,
                surfaces: validation.surfaces,
                warnings: validation.warnings,
                note: validation.warnings.length > 0
                    ? 'Address the warnings if they were not intentional.'
                    : 'Keep the accompanying prose brief: the interface carries the detail. Do not repeat the rendered values in text.',
            };
            return value;
        },
    };
}
function safeStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return undefined;
    }
}
function buildCatalogTool() {
    return {
        name: CATALOG_TOOL_NAME,
        description: 'Return the A2UI 1.0 component and function reference for this plugin. Call it before authoring a non-trivial surface (tables, charts, plots, animations, forms) so that component and property names are exact.',
        parameters: {
            type: 'object',
            properties: {
                detail: {
                    type: 'string',
                    enum: ['brief', 'full'],
                    description: '"brief" lists component names and purpose; "full" (default) adds property names.',
                },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
            },
            render: (_args, value) => [textBlock(value.text)],
        },
        async execute(args) {
            const detail = args?.detail === 'brief' ? 'brief' : 'full';
            return { text: describeCatalog(detail) };
        },
    };
}
function sectionText(toolName, catalogTool, proactive) {
    const decision = proactive
        ? [
            '## Generative UI (A2UI 1.0)',
            '',
            `Render an interactive interface inline with \`${toolName}\` (A2UI 1.0 messages: \`createSurface\`, \`updateComponents\`, \`updateDataModel\`, \`deleteSurface\`).`,
            '',
            '**Decide from what the answer contains, not from how the user phrased the request.** No one has to say "chart", "visualize", "UI" or "a2ui".',
            '',
            'Render a surface when the answer has:',
            '- 3+ comparable rows (options, versions, items, before/after) → `Table`; 2-4 headline numbers → `Row` of `Stat`.',
            '- values over time, across categories, or as shares → `BarChart` / `LineChart` / `PieChart`.',
            '- a target, progress or coverage → `Progress` / `Stat`.',
            '- a value worth trying out, or a formula → `Slider` + `Plot` bound to the data model.',
            '- paired numeric observations → `Plot` scatter with the original X/Y values, labeled axes, and a series for each group.',
            '- third nonnegative metric → scatter `size` and `sizeLabel`; fitted trend → `regression:"linear"` on the scatter series.',
            '- ranked shares → `ParetoChart`; common-scale profiles → `RadarChart`; known intervals → `errorBars`.',
            '- a numeric matrix with meaningful patterns across two axes → `Heatmap`; retain missing cells as null and use a diverging scale for signed comparisons.',
            '- milestones, releases, or an incident sequence where order helps → `Timeline` in the intended reading order.',
            '- discrete steps, an ordering or an algorithm walk-through → `FramePlayer`.',
            '- input the user must give, or a decision to approve → form components + one submit/approve button.',
            '',
            'Keep it prose: one fact, a definition, a yes/no, a greeting, a short explanation, code, diffs, logs, paths.',
            'Never repeat in text the numbers a surface already shows; one card per answer, two charts at most.',
            'For one chart, a short Timeline, or a small Section, use "presentation":"compact" before "messages" and omit a title the answer already supplies.',
            '',
            'Rules:',
            '- The component graph root id MUST be "root"; components are flat and reference each other by id.',
            '- Bind interactive `value` properties to the data model (`{"@path":"/form/name"}`) and repeat those paths in the action `context`.',
            `- Each call renders its own card from that call's messages. To show a changed interface, send a complete surface (\`createSurface\` with its components and dataModel); \`updateComponents\`/\`updateDataModel\` alone render as an "updated" note, because an earlier card is a separate snapshot.`,
            '- Keep one surface small: at most a few hundred declared components, a few thousand rendered nodes (templates multiply), and a few thousand table rows plus chart points. Larger payloads are rejected before rendering.',
            catalogTool ? `- Call \`${CATALOG_TOOL_NAME}\` for exact component or property names.` : '',
        ]
        : [
            '## Generative UI (A2UI 1.0)',
            '',
            `You can render an interactive interface inline in the conversation with the \`${toolName}\` tool (A2UI 1.0 messages: \`createSurface\`, \`updateComponents\`, \`updateDataModel\`, \`deleteSurface\`).`,
            '',
            'Only render a surface when the user asks for one, or when it is the clearest way to answer a comparison, a chart, a parameter exploration, a form, or a step-by-step animation.',
            'Prefer plain Markdown for explanations, prose and simple lists. Never show the same numbers twice.',
            'Use "presentation":"compact" before "messages" for one chart, a short Timeline, or a small Section within the answer.',
            '',
            'Rules that keep it working:',
            '- The component graph root id MUST be "root". Components are declared flat and reference each other by id.',
            '- Bind interactive `value` properties to the data model (`{"@path":"/form/name"}`) so edits stay local; put the same paths in the action `context` so the submit button carries the values.',
            `- Each call renders its own card from that call's messages. To show a changed interface, send a complete surface (\`createSurface\` with its components and dataModel); \`updateComponents\`/\`updateDataModel\` alone render as an "updated" note, because an earlier card is a separate snapshot.`,
            '- Keep one surface small: at most a few hundred declared components, a few thousand rendered nodes (templates multiply), and a few thousand table rows plus chart points. Larger payloads are rejected before rendering.',
            catalogTool ? `- Call \`${CATALOG_TOOL_NAME}\` when you need exact component or property names.` : '',
        ];
    const lines = [
        ...decision,
        '',
        'Interactive by default — never add a button for something the UI already does locally:',
        '- Charts and tables are interactive on their own: hover shows a tooltip and highlights the point, a legend entry toggles its series, table headers sort the rows, tabs switch, sliders and plots redraw, FramePlayer plays. All local, no message, no turn.',
        '- Add an `action.event` button ONLY when the user asked for an action that needs you: submitting a form, approving or rejecting, or fetching fresh data. Every such click sends a message and starts a turn, so never add decorative buttons, duplicate buttons, or one that merely restates a control.',
        '- Never add a button whose only effect is to remove or hide the interface the user is looking at.',
        '',
        'User actions arrive as a user message beginning with `[A2UI action]` followed by a fenced JSON object whose `action` field carries `name`, `surfaceId`, `sourceComponentId`, `context` and `timestamp`. Treat it as a genuine user request: continue the task, then update the surface or answer.',
        '- Function calls in `action.functionCall` run inside the renderer and only change local state; nothing is sent to you.',
        '- Anything with side effects (files, commands, network, external services) must still go through your normal tools, so the usual approvals apply. A surface can never grant itself permissions.',
    ];
    return lines.filter((line) => line !== undefined && line !== '').join('\n');
}
/**
 * Mount the A2UI tools and prompt section.
 * @param ctx Host plugin context.
 * @param config bundle-row configuration.
 */
export function apply(ctx, config = {}) {
    const toolName = typeof config.toolName === 'string' && /^[a-z][a-z0-9_]{1,40}$/u.test(config.toolName) ? config.toolName : DEFAULT_TOOL_NAME;
    const catalogTool = config.catalogTool !== false;
    const sectionOrder = Number.isFinite(config.sectionOrder) ? Number(config.sectionOrder) : DEFAULT_SECTION_ORDER;
    const proactive = config.autoRender !== false;
    ctx.effect(() => ctx.tools.register(buildTool(toolName, proactive, catalogTool)), 'dsh-a2ui: tool');
    if (catalogTool) {
        ctx.effect(() => ctx.tools.register(buildCatalogTool()), 'dsh-a2ui: catalog tool');
    }
    if (config.muteSection !== true && ctx.systemPrompt !== undefined) {
        ctx.effect(() => ctx.systemPrompt.section({
            name: 'dsh-a2ui:guidance',
            order: sectionOrder,
            text: sectionText(toolName, catalogTool, proactive),
        }), 'dsh-a2ui: prompt section');
    }
}
/** Stable plugin name for diagnostics. */
export const name = 'dsh-a2ui';
/** Hard dependency: the tool registry must exist for this plugin to do anything. */
export const inject = ['tools', 'systemPrompt'];
/** Exported for tests. */
export const internals = { buildTool, buildCatalogTool, sectionText, LIMITS };
