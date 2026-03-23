// @ts-check
/**
 * src/copilot/lib/tools-registry.js
 *
 * Registry de Custom Tools para o Copilot SDK. Permite registrar, filtrar, compor e inspecionar conjuntos de
 * ferramentas por categoria, capacidade ou agente.
 *
 * Uso típico: import { createRegistry, registerTools, getToolsByCategory } from '#copilot/lib/tools-registry'; const
 * reg = createRegistry(); registerTools(reg, codeTools, { category: 'code' }); const subset = getToolsByCategory(reg,
 * 'code');
 *
 * @module copilot/lib/tools-registry
 */

/**
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 */

/**
 * @typedef {object} ToolEntry
 * @property {Tool} tool - Instância da ferramenta SDK
 * @property {string} category - Categoria funcional (ex: 'code', 'git', 'session', 'task', 'hook')
 * @property {string[]} [tags] - Tags adicionais para filtro
 * @property {boolean} [readOnly] - Se true, a ferramenta não modifica estado externo
 */

/**
 * @typedef {object} ToolRegistry
 * @property {Map<string, ToolEntry>} entries - Mapa de nome → ToolEntry
 */

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Cria um novo registry de ferramentas vazio.
 *
 * @returns {ToolRegistry}
 */
export function createRegistry() {
    return { entries: new Map() };
}

// ─── Registro ────────────────────────────────────────────────────────────────

/**
 * Registra uma ferramenta individual no registry.
 *
 * @param {ToolRegistry} registry
 * @param {Tool} tool
 * @param {object} [meta={}] Metadados da entrada. Default is `{}`
 * @param {string} [meta.category='uncategorized'] Categoria funcional da ferramenta. Default is `'uncategorized'`
 * @param {string[]} [meta.tags=[]] Tags adicionais. Default is `[]`
 * @param {boolean} [meta.readOnly=false] Se a ferramenta é somente-leitura. Default is `false`
 * @returns {void}
 * @throws {Error} Se tool ou tool.name for inválido
 */
export function registerTool(registry, tool, meta = {}) {
    if (!registry || !registry.entries) throw new Error('[lib/tools-registry] registry inválido.');
    if (!tool || typeof tool.name !== 'string' || !tool.name)
        throw new Error('[lib/tools-registry] registerTool: tool.name (string) é obrigatório.');

    const { category = 'uncategorized', tags = [], readOnly = false } = meta;

    registry.entries.set(tool.name, { tool, category, tags, readOnly });
}

/**
 * Registra um array de ferramentas no registry com os mesmos metadados.
 *
 * @param {ToolRegistry} registry
 * @param {Tool[]} tools
 * @param {object} [meta={}] Metadados aplicados a todas as ferramentas. Default is `{}`
 * @param {string} [meta.category='uncategorized'] Default is `'uncategorized'`
 * @param {string[]} [meta.tags=[]] Default is `[]`
 * @param {boolean} [meta.readOnly=false] Default is `false`
 * @returns {void}
 */
export function registerTools(registry, tools, meta = {}) {
    for (const tool of tools) {
        registerTool(registry, tool, meta);
    }
}

// ─── Consulta ────────────────────────────────────────────────────────────────

/**
 * Retorna todas as ferramentas registradas como array.
 *
 * @param {ToolRegistry} registry
 * @returns {Tool[]}
 */
export function getAllTools(registry) {
    return Array.from(registry.entries.values()).map((e) => e.tool);
}

/**
 * Retorna ferramentas de uma categoria específica.
 *
 * @param {ToolRegistry} registry
 * @param {string} category
 * @returns {Tool[]}
 */
export function getToolsByCategory(registry, category) {
    const result = [];
    for (const entry of registry.entries.values()) {
        if (entry.category === category) result.push(entry.tool);
    }
    return result;
}

/**
 * Retorna ferramentas que possuem uma tag específica.
 *
 * @param {ToolRegistry} registry
 * @param {string} tag
 * @returns {Tool[]}
 */
export function getToolsByTag(registry, tag) {
    const result = [];
    for (const entry of registry.entries.values()) {
        if (entry.tags && entry.tags.includes(tag)) result.push(entry.tool);
    }
    return result;
}

/**
 * Retorna apenas as ferramentas marcadas como somente-leitura.
 *
 * @param {ToolRegistry} registry
 * @returns {Tool[]}
 */
export function getReadOnlyTools(registry) {
    const result = [];
    for (const entry of registry.entries.values()) {
        if (entry.readOnly) result.push(entry.tool);
    }
    return result;
}

/**
 * Retorna uma ferramenta pelo nome ou `undefined` se não encontrada.
 *
 * @param {ToolRegistry} registry
 * @param {string} name
 * @returns {Tool | undefined}
 */
export function getToolByName(registry, name) {
    return registry.entries.get(name)?.tool;
}

/**
 * Retorna nomes de todas as ferramentas registradas.
 *
 * @param {ToolRegistry} registry
 * @returns {string[]}
 */
export function listToolNames(registry) {
    return Array.from(registry.entries.keys());
}

/**
 * Retorna true se uma ferramenta com esse nome está registrada.
 *
 * @param {ToolRegistry} registry
 * @param {string} name
 * @returns {boolean}
 */
export function hasToolByName(registry, name) {
    return registry.entries.has(name);
}

/**
 * Retorna o número total de ferramentas registradas.
 *
 * @param {ToolRegistry} registry
 * @returns {number}
 */
export function getToolCount(registry) {
    return registry.entries.size;
}

// ─── Composição ──────────────────────────────────────────────────────────────

/**
 * Mescla dois registries em um novo registry. Entradas com mesmo nome do `secondary` sobrescrevem as do `primary`.
 *
 * @param {ToolRegistry} primary
 * @param {ToolRegistry} secondary
 * @returns {ToolRegistry}
 */
export function mergeRegistries(primary, secondary) {
    const merged = createRegistry();
    for (const [name, entry] of primary.entries) {
        merged.entries.set(name, entry);
    }
    for (const [name, entry] of secondary.entries) {
        merged.entries.set(name, entry);
    }
    return merged;
}

/**
 * Cria um sub-registry contendo apenas as ferramentas cujos nomes estão na lista.
 *
 * @param {ToolRegistry} registry
 * @param {string[]} names
 * @returns {ToolRegistry}
 */
export function filterByNames(registry, names) {
    const filtered = createRegistry();
    const nameSet = new Set(names);
    for (const [name, entry] of registry.entries) {
        if (nameSet.has(name)) filtered.entries.set(name, entry);
    }
    return filtered;
}

/**
 * Cria um sub-registry excluindo ferramentas com nomes na lista.
 *
 * @param {ToolRegistry} registry
 * @param {string[]} names
 * @returns {ToolRegistry}
 */
export function excludeByNames(registry, names) {
    const filtered = createRegistry();
    const nameSet = new Set(names);
    for (const [name, entry] of registry.entries) {
        if (!nameSet.has(name)) filtered.entries.set(name, entry);
    }
    return filtered;
}

// ─── Inspeção ────────────────────────────────────────────────────────────────

/**
 * Retorna um snapshot descritivo do registry (útil para debug).
 *
 * @param {ToolRegistry} registry
 * @returns {{ total: number; categories: Record<string, number>; names: string[] }}
 */
export function inspectRegistry(registry) {
    /** @type {Record<string, number>} */
    const categories = {};
    const names = [];

    for (const [name, entry] of registry.entries) {
        names.push(name);
        categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    }

    return { total: registry.entries.size, categories, names };
}
