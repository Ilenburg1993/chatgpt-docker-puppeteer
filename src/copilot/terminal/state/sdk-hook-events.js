// @ts-check
/**
 * Estado terminal para eventos de hooks do SDK.
 *
 * A sessão SDK já expõe `onUserPromptSubmitted`; aqui mantemos uma projeção pequena e consultável para a UX do
 * terminal, sem guardar prompts completos por padrão.
 *
 * @module copilot/terminal/state/sdk-hook-events
 */

const MAX_PROMPT_HOOK_EVENTS = 80;
const PREVIEW_CHARS = 220;

/** @typedef {'prompt_submitted'} TerminalSdkHookKind */

/**
 * @typedef {object} TerminalPromptHookEntry
 * @property {string} id
 * @property {TerminalSdkHookKind} kind
 * @property {string | null} sessionId
 * @property {number} timestamp
 * @property {number} promptLength
 * @property {string} promptPreview
 * @property {boolean} modified
 * @property {number | null} modifiedPromptLength
 * @property {string | null} modifiedPromptPreview
 * @property {string | null} additionalContextPreview
 * @property {boolean | null} suppressOutput
 */

/** @type {TerminalPromptHookEntry[]} */
const _promptHooks = [];

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringOrEmpty(value) {
    return typeof value === 'string' ? value : '';
}

/**
 * @param {string} value
 * @param {number} [max=PREVIEW_CHARS]
 * @returns {string}
 */
function preview(value, max = PREVIEW_CHARS) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

/**
 * @param {unknown} evt
 * @returns {TerminalPromptHookEntry}
 */
export function recordTerminalPromptHookSubmitted(evt) {
    const event = objectOrNull(evt) ?? {};
    const input = objectOrNull(event['input']) ?? {};
    const output = objectOrNull(event['output']) ?? {};
    const prompt = stringOrEmpty(input['prompt']);
    const modifiedPrompt = stringOrEmpty(output['modifiedPrompt']);
    const additionalContext = stringOrEmpty(output['additionalContext']);
    const timestamp =
        typeof event['timestamp'] === 'number' && Number.isFinite(event['timestamp']) ? event['timestamp'] : Date.now();
    const entry = {
        id: `prompt-hook-${timestamp.toString(36)}-${_promptHooks.length.toString(36)}`,
        kind: /** @type {TerminalSdkHookKind} */ ('prompt_submitted'),
        sessionId: typeof event['sessionId'] === 'string' && event['sessionId'].length > 0 ? event['sessionId'] : null,
        timestamp,
        promptLength: prompt.length,
        promptPreview: preview(prompt),
        modified: modifiedPrompt.length > 0 && modifiedPrompt !== prompt,
        modifiedPromptLength: modifiedPrompt.length > 0 ? modifiedPrompt.length : null,
        modifiedPromptPreview: modifiedPrompt.length > 0 ? preview(modifiedPrompt) : null,
        additionalContextPreview: additionalContext.length > 0 ? preview(additionalContext) : null,
        suppressOutput: typeof output['suppressOutput'] === 'boolean' ? output['suppressOutput'] : null,
    };
    _promptHooks.unshift(entry);
    if (_promptHooks.length > MAX_PROMPT_HOOK_EVENTS) {
        _promptHooks.length = MAX_PROMPT_HOOK_EVENTS;
    }
    return { ...entry };
}

/**
 * @param {{ limit?: number }} [opts]
 * @returns {TerminalPromptHookEntry[]}
 */
export function listTerminalPromptHookEvents(opts = {}) {
    const limit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 10;
    return _promptHooks.slice(0, limit).map((entry) => ({ ...entry }));
}

/**
 * @returns {{ total: number; latest: TerminalPromptHookEntry | null; modified: number }}
 */
export function readTerminalPromptHookSummary() {
    return {
        total: _promptHooks.length,
        latest: _promptHooks[0] ? { ..._promptHooks[0] } : null,
        modified: _promptHooks.filter((entry) => entry.modified).length,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalPromptHookEvents() {
    _promptHooks.length = 0;
}
