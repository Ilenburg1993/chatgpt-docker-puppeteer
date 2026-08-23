// @ts-check
/** Canonical contracts for SDK executable tool definitions and tool names. */

/** @type {RegExp} */
export const TOOL_NAME_RE = /^[a-zA-Z0-9_]+$/;

/** @param {unknown} names @returns {string[]} */
export function sanitizeToolNames(names) {
    if (!Array.isArray(names)) return [];
    const unique = new Set();
    for (const raw of names) {
        if (typeof raw !== 'string') continue;
        const normalized = raw.trim();
        if (!normalized || !TOOL_NAME_RE.test(normalized)) continue;
        unique.add(normalized);
    }
    return [...unique];
}

/**
 * @param {unknown} tool
 * @returns {{ok:true;value:Record<string,unknown>}|{ok:false;reason:string}}
 */
export function validateToolDefinitionContract(tool) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool))
        return { ok: false, reason: 'tool (object) obrigatório.' };
    const candidate = /** @type {Record<string,unknown>} */ (tool);
    const name = candidate['name'];
    if (typeof name !== 'string' || !name.trim()) return { ok: false, reason: 'name (string) obrigatório.' };
    if (!TOOL_NAME_RE.test(name.trim()))
        return { ok: false, reason: `name '${name}' contém caracteres não suportados.` };
    const description = candidate['description'];
    if (typeof description !== 'string' || !description.trim())
        return { ok: false, reason: 'description (string) obrigatório.' };
    if (typeof candidate['handler'] !== 'function') return { ok: false, reason: 'handler (function) obrigatório.' };
    const parameters = candidate['parameters'];
    if (parameters !== undefined && (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))) {
        return { ok: false, reason: 'parameters deve ser object quando definido.' };
    }
    const instructions = candidate['instructions'];
    if (instructions !== undefined && typeof instructions !== 'string')
        return { ok: false, reason: 'instructions deve ser string quando definido.' };
    const skipPermission = candidate['skipPermission'];
    if (skipPermission !== undefined && typeof skipPermission !== 'boolean')
        return { ok: false, reason: 'skipPermission deve ser boolean quando definido.' };
    return { ok: true, value: candidate };
}
