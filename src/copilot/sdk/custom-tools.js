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

import { log } from '#copilot/observability/logger';
import { buildTool } from '#copilot/tools/tool-factory';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';
import { safeJsonParse } from '../core/safe-json.js';
import { CustomToolsFileSchema } from '../core/schemas.js';

/** Caminho do arquivo de persistência. @type {string} */
const CUSTOM_TOOLS_PATH = join(resolve(import.meta.dirname, '../..'), 'custom-tools.json');

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
            // C12-02: allowlist explícita — bloquear exposição de tokens/secrets ao modelo
            const ENV_ALLOWLIST = new Set([
                'NODE_ENV',
                'COPILOT_WORKING_DIRECTORY',
                'COPILOT_DB_PATH',
                'TZ',
                'LANG',
                'HOME',
                'HOSTNAME',
                'PATH',
                'npm_package_version',
                'npm_lifecycle_event',
            ]);
            if (!ENV_ALLOWLIST.has(key)) {
                return `(variável '${key}' não está na allowlist de leitura)`;
            }
            const val = process.env[key];
            return val !== undefined ? val : '(não definido)';
        },
    ],
    // ── Handlers adicionais (I1 — Fase 2) ─────────────────────────────────────
    [
        'process_info',
        () =>
            JSON.stringify({
                pid: process.pid,
                uptime: Math.floor(process.uptime()),
                nodeVersion: process.version,
                platform: process.platform,
                memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                env: process.env['NODE_ENV'] ?? 'development',
            }),
    ],
    [
        'uptime',
        () => {
            const s = Math.floor(process.uptime());
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            return `${h}h ${m}m ${sec}s (${s}s total)`;
        },
    ],
    [
        'math_eval',
        (args) => {
            const expr = typeof args['expression'] === 'string' ? args['expression'].trim() : '';
            if (!expr) return '(expressão ausente)';
            // Suporta expressões simples: um operador entre dois números (ex: "42 + 58", "10 * 3.5").
            const m = /^(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)$/.exec(expr);
            if (!m) return '(expressão não suportada — use: número operador número)';
            const a = parseFloat(m[1] ?? '');
            const op = m[2];
            const b = parseFloat(m[3] ?? '');
            if (op === '+') return String(a + b);
            if (op === '-') return String(a - b);
            if (op === '*') return String(a * b);
            if (op === '/') return b === 0 ? '(divisão por zero)' : String(a / b);
            return '(operador inválido)';
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
 * @deprecated F92: Use loadCustomToolsAsync() em fluxos assíncronos.
 * @returns {void}
 */
export function loadCustomTools() {
    // FS-SYNC: init-time-safe (deprecated sync fallback)
    if (!existsSync(CUSTOM_TOOLS_PATH)) return;
    try {
        const raw = readFileSync(CUSTOM_TOOLS_PATH, 'utf8');
        const jsonResult = safeJsonParse(raw, '[custom-tools/loadCustomTools]');
        const items = /** @type {unknown} */ (jsonResult.ok ? jsonResult.data : null);
        if (!Array.isArray(items)) return;
        _registry = new Map(
            items
                .filter(
                    (/** @type {unknown} */ item) =>
                        item &&
                        typeof item === 'object' &&
                        typeof (/** @type {Record<string, unknown>} */ (item)['name']) === 'string' &&
                        typeof (/** @type {Record<string, unknown>} */ (item)['description']) === 'string' &&
                        typeof (/** @type {Record<string, unknown>} */ (item)['handlerId']) === 'string',
                )
                .map(
                    (/** @type {unknown} */ item) =>
                        /** @type {[string, CustomToolDefinition]} */ ([
                            /** @type {string} */ (/** @type {Record<string, unknown>} */ (item)['name']),
                            /** @type {CustomToolDefinition} */ (item),
                        ]),
                ),
        );
        log('INFO', `[custom-tools-registry] ${_registry.size} custom tool(s) carregadas do disco.`);
    } catch (/** @type {any} */ err) {
        log('WARN', `[custom-tools-registry] Falha ao carregar custom-tools.json: ${err.message}`);
    }
}

/**
 * Persiste o registry atual no disco.
 *
 * @deprecated F92: Use persistCustomToolsAsync() em fluxos assíncronos.
 * @returns {void}
 */
function persistCustomTools() {
    // FS-SYNC: init-time-safe (deprecated sync fallback)
    try {
        // C12-04: write atômico — escreve em tmpfile e faz rename para evitar JSON corrompido em crash
        const tmpPath = `${CUSTOM_TOOLS_PATH}.tmp`;
        writeFileSync(tmpPath, JSON.stringify([..._registry.values()], null, 2), 'utf8');
        renameSync(tmpPath, CUSTOM_TOOLS_PATH);
    } catch (/** @type {any} */ err) {
        log('WARN', `[custom-tools-registry] Falha ao persistir custom-tools.json: ${err.message}`);
    }
}

/**
 * F92: Versão async de loadCustomTools — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
export async function loadCustomToolsAsync() {
    try {
        const raw = await readFile(CUSTOM_TOOLS_PATH, 'utf8');
        const jsonResult = safeJsonParse(raw, '[custom-tools/loadCustomToolsAsync]');
        if (!jsonResult.ok) {
            log('WARN', '[custom-tools-registry] custom-tools.json JSON inválido.');
            return;
        }
        const jsonData = /** @type {unknown} */ (jsonResult.data);
        const result = CustomToolsFileSchema.safeParse(jsonData);
        if (!result.success || !result.data) {
            log('WARN', '[custom-tools-registry] custom-tools.json schema inválido — registry vazio.');
            return;
        }
        const items = result.data;
        _registry = new Map(items.map((item) => [item.name, item]));
        log('INFO', `[custom-tools-registry] ${_registry.size} custom tool(s) carregadas do disco (async).`);
    } catch (/** @type {any} */ e) {
        logSwallowed(e, 'sdk.customTools.loadRegistry');
    }
}

/**
 * F92: Versão async de persistCustomTools — usa fs/promises com write atômico.
 *
 * @returns {Promise<void>}
 */
async function _persistCustomToolsAsync() {
    try {
        const tmpPath = `${CUSTOM_TOOLS_PATH}.tmp`;
        await writeFile(tmpPath, JSON.stringify([..._registry.values()], null, 2), 'utf8');
        await rename(tmpPath, CUSTOM_TOOLS_PATH);
    } catch (/** @type {any} */ err) {
        log('WARN', `[custom-tools-registry] Falha ao persistir custom-tools.json (async): ${err.message}`);
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

/**
 * Reseta o estado interno do registry para isolamento de testes. **Não usar em produção.**
 *
 * @returns {void}
 * @internal
 */
export function _resetRegistry() {
    _registry = new Map();
}
