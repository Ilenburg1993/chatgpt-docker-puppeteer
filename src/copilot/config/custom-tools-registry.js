// @ts-check
/**
 * src/copilot/config/custom-tools-registry.js
 *
 * AI.2 — Registry em runtime de Custom Tools declarativas. Permite registrar, listar e remover tools por nome via API
 * HTTP sem reinicialização do agente. O registry persiste em `custom-tools.json` na raiz do projeto.
 *
 * **Segurança**: nenhuma tool é carregada via `eval` ou código dinâmico. Cada tool registrada deve referenciar um
 * handler pelo id de uma função pré-autorizada no `BUILTIN_HANDLER_MAP` deste módulo. Chamadas externas com `handlerId`
 * desconhecido são rejeitadas.
 *
 * **Integração**: `getCustomToolDefinitions()` retorna os registros declarativos. `buildCustomTools()` instancia os
 * objetos `Tool` a partir dos registros, para uso por `tools-bootstrap.js`.
 *
 * @module copilot/config/custom-tools-registry
 */

import { buildTool } from '#copilot/tools/tool-factory';
import { log } from '#core/logger';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Caminho do arquivo de persistência. @type {string} */
const CUSTOM_TOOLS_PATH = join(resolve(import.meta.dirname, '../../..'), 'custom-tools.json');

/**
 * Mapa de handlers pré-autorizados para custom tools declarativas. Adicionar funções aqui para disponibilizá-las via
 * API.
 *
 * Chave: id referenciado por `CustomToolDefinition.handlerId` Valor: função `(args: unknown) => Promise<string> |
 * string`
 *
 * @type {Map<string, (args: Record<string, unknown>) => Promise<string> | string>}
 */
export const BUILTIN_HANDLER_MAP = new Map([
    [
        'echo',
        (args) => {
            const text = typeof args['text'] === 'string' ? args['text'] : JSON.stringify(args);
            return `echo: ${text}`;
        },
    ],
    ['timestamp', () => new Date().toISOString()],
    [
        'env_read',
        (args) => {
            const key = typeof args['key'] === 'string' ? args['key'] : '';
            if (!key) return '(key ausente)';
            const val = process.env[key];
            return val !== undefined ? val : '(não definido)';
        },
    ],
]);

/**
 * Definição declarativa de uma custom tool registrada via API.
 *
 * @typedef {object} CustomToolDefinition
 * @property {string} name - Nome único da tool (snake_case)
 * @property {string} description - Descrição para o modelo
 * @property {string} handlerId - Id do handler no BUILTIN_HANDLER_MAP
 * @property {Record<string, unknown>} [parameters] - JSON Schema dos parâmetros (opcional)
 */

/**
 * Registry em memória de custom tools declarativas.
 *
 * @type {Map<string, CustomToolDefinition>}
 */
let _registry = new Map();

/**
 * Carrega o registry do disco. Chamado na inicialização do módulo.
 *
 * @returns {void}
 */
export function loadCustomTools() {
    if (!existsSync(CUSTOM_TOOLS_PATH)) return;
    try {
        const raw = readFileSync(CUSTOM_TOOLS_PATH, 'utf8');
        const items = /** @type {unknown} */ (JSON.parse(raw));
        if (!Array.isArray(items)) return;
        _registry = new Map(
            items
                .filter(
                    (/** @type {unknown} */ item) =>
                        item &&
                        typeof item === 'object' &&
                        typeof (/** @type {any} */ (item).name) === 'string' &&
                        typeof (/** @type {any} */ (item).description) === 'string' &&
                        typeof (/** @type {any} */ (item).handlerId) === 'string',
                )
                .map((/** @type {any} */ item) => [item.name, item]),
        );
        log('INFO', `[custom-tools-registry] ${_registry.size} custom tool(s) carregadas do disco.`);
    } catch (/** @type {any} */ err) {
        log('WARN', `[custom-tools-registry] Falha ao carregar custom-tools.json: ${err.message}`);
    }
}

/**
 * Persiste o registry atual no disco.
 *
 * @returns {void}
 */
function persistCustomTools() {
    try {
        writeFileSync(CUSTOM_TOOLS_PATH, JSON.stringify([..._registry.values()], null, 2), 'utf8');
    } catch (/** @type {any} */ err) {
        log('WARN', `[custom-tools-registry] Falha ao persistir custom-tools.json: ${err.message}`);
    }
}

/**
 * Retorna todas as definições de custom tools registradas.
 *
 * @returns {CustomToolDefinition[]}
 */
export function getCustomToolDefinitions() {
    return [..._registry.values()];
}

/**
 * Registra uma nova custom tool declarativa. Retorna erro se o `handlerId` não for reconhecido.
 *
 * @param {CustomToolDefinition} def
 * @returns {{ ok: boolean; error?: string }}
 */
export function registerCustomTool(def) {
    if (!def.name || typeof def.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(def.name)) {
        return { ok: false, error: 'name inválido: deve ser snake_case, 1–64 caracteres' };
    }
    if (!BUILTIN_HANDLER_MAP.has(def.handlerId)) {
        return {
            ok: false,
            error: `handlerId '${def.handlerId}' não reconhecido. Disponíveis: ${[...BUILTIN_HANDLER_MAP.keys()].join(', ')}`,
        };
    }
    _registry.set(def.name, {
        name: def.name,
        description: def.description || def.name,
        handlerId: def.handlerId,
        ...(def.parameters ? { parameters: def.parameters } : {}),
    });
    persistCustomTools();
    log('INFO', `[custom-tools-registry] Tool '${def.name}' registrada (handler: ${def.handlerId}).`);
    return { ok: true };
}

/**
 * Remove uma custom tool pelo nome.
 *
 * @param {string} name
 * @returns {{ ok: boolean; error?: string }}
 */
export function removeCustomTool(name) {
    if (!_registry.has(name)) {
        return { ok: false, error: `Tool '${name}' não encontrada.` };
    }
    _registry.delete(name);
    persistCustomTools();
    log('INFO', `[custom-tools-registry] Tool '${name}' removida.`);
    return { ok: true };
}

/**
 * Constrói instâncias `Tool` SDK a partir das definições registradas. Cada tool com `handlerId` inválido é ignorada com
 * warning (proteção contra corrupção do arquivo de persistência).
 *
 * @returns {import('@github/copilot-sdk').Tool[]}
 */
export function buildCustomTools() {
    /** @type {import('@github/copilot-sdk').Tool[]} */
    const tools = [];
    for (const def of _registry.values()) {
        const handler = BUILTIN_HANDLER_MAP.get(def.handlerId);
        if (!handler) {
            log(
                'WARN',
                `[custom-tools-registry] Handler '${def.handlerId}' para tool '${def.name}' não encontrado — ignorada.`,
            );
            continue;
        }
        tools.push(
            buildTool({
                name: def.name,
                description: def.description,
                ...(def.parameters ? { parameters: def.parameters } : {}),
                handler: async (args) => {
                    const result = await handler(/** @type {Record<string, unknown>} */ (args));
                    return typeof result === 'string' ? result : JSON.stringify(result);
                },
            }),
        );
    }
    return tools;
}

// Carrega ao inicializar o módulo
loadCustomTools();
