// @ts-check
import { ConfigError } from '#copilot/core';
/**
 * src/copilot/sdk/tools-registry.js
 *
 * Registry de ferramentas para o Copilot SDK. Permite registrar, filtrar, compor e inspecionar conjuntos de ferramentas
 * por categoria, capacidade ou agente.
 *
 * @module copilot/sdk/tools-registry
 * @see EventBus
 * @see module:copilot/sdk/tools
 * @see module:copilot/sdk/custom-tools
 */

/**
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 */

/**
 * Tool extendida com o campo `instructions` usado internamente. O campo não existe no tipo oficial do SDK — é injetado
 * no registry para guiar o LLM sobre como usar a ferramenta.
 *
 * @typedef {Tool & { instructions?: string }} ExtendedTool
 */

/**
 * @typedef {object} ToolEntry
 * @property {ExtendedTool} tool - Instância da ferramenta (pode conter instructions)
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
 * @example
 *     const reg = createRegistry();
 *     registerTool(reg, myTool, { category: 'code' });
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
 * @throws {ConfigError} Se tool ou tool.name for inválido
 * @see createRegistry
 */
export function registerTool(registry, tool, meta = {}) {
    if (!registry || !registry.entries) throw new ConfigError('[sdk/tools-registry] registry inválido.');
    if (!tool || typeof tool.name !== 'string' || !tool.name)
        throw new ConfigError('[sdk/tools-registry] registerTool: tool.name (string) é obrigatório.');

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
 * Retorna ferramentas que satisfazem o predicado fornecido.
 *
 * @param {ToolRegistry} registry
 * @param {(entry: ToolEntry) => boolean} predicate
 * @returns {Tool[]}
 */
export function getToolsBy(registry, predicate) {
    return Array.from(registry.entries.values())
        .filter(predicate)
        .map((e) => e.tool);
}

/**
 * Retorna ferramentas de uma categoria específica.
 *
 * @param {ToolRegistry} registry
 * @param {string} category
 * @returns {Tool[]}
 */
export function getToolsByCategory(registry, category) {
    return getToolsBy(registry, (e) => e.category === category);
}

/**
 * Retorna ferramentas que possuem uma tag específica.
 *
 * @param {ToolRegistry} registry
 * @param {string} tag
 * @returns {Tool[]}
 */
export function getToolsByTag(registry, tag) {
    return getToolsBy(registry, (e) => Array.isArray(e.tags) && e.tags.includes(tag));
}

/**
 * Retorna apenas as ferramentas marcadas como somente-leitura.
 *
 * @param {ToolRegistry} registry
 * @returns {Tool[]}
 */
export function getReadOnlyTools(registry) {
    return getToolsBy(registry, (e) => e.readOnly === true);
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

// ─── IToolRegistry adapter (Faixa 3.2 — AC-5-04) ────────────────────────────

/**
 * Cria um adapter OOP sobre o registry funcional, implementando a interface
 * {@link import('../../core/interfaces.js').IToolRegistry IToolRegistry}.
 *
 * @param {ToolRegistry} [inner] - Registry interno. Se omitido, cria um novo vazio.
 * @returns {import('../../core/interfaces.js').IToolRegistry}
 */
export function createToolRegistryAdapter(inner) {
    const reg = inner ?? createRegistry();
    return {
        entries: reg.entries,
        register: (tool, meta) => registerTool(reg, /** @type {Tool} */ (tool), meta),
        getByCategory: (category) => getToolsByCategory(reg, category),
        getByTag: (tag) => getToolsByTag(reg, tag),
        filter: (names) => createToolRegistryAdapter(filterByNames(reg, names)),
        list: () => getAllTools(reg),
        stats: () => {
            const info = inspectRegistry(reg);
            return { total: info.total, byCategory: info.categories };
        },
    };
}
