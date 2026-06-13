// @ts-check
/**
 * src/copilot/sdk/tools/custom.js
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
 * @module copilot/sdk/tools/custom
 * @see EventBus
 */

import { logSwallowed, toError } from '#copilot/core/error-handlers';
import { safeJsonParse } from '#copilot/core/safe-json';
import { CustomToolsFileSchema } from '#copilot/core/schemas';
import { writeFileAtomicTrusted } from '#copilot/infra/public/trusted-io';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { log } from '../logger.js';
import { resolvePersistentConfigFile } from '../persistent-paths.js';

/**
 * @typedef {(opts: {
 *     name: string;
 *     description: string;
 *     parameters?: import('./core.js').ToolParameterInput<any>;
 *     handler: Function;
 *     requiresApproval?: boolean;
 *     overridesBuiltInTool?: boolean;
 * }) => import('@github/copilot-sdk').Tool} BuildToolFn
 */

/** @type {BuildToolFn | null} */
let _buildTool = null;

/** @type {Promise<void> | null} */
let _loadPromise = null;

/** @type {boolean} */
let _loaded = false;

/** @type {Promise<void>} */
let _persistQueue = Promise.resolve();

/**
 * Injeta a factory `buildTool` de `tools/tool-factory`. Chamado uma vez durante o bootstrap.
 *
 * @param {BuildToolFn} fn
 */
export function setCustomToolsBuilder(fn) {
    _buildTool = typeof fn === 'function' ? fn : null;
}

/**
 * Resolve o builder canônico de custom tools.
 *
 * Arquitetura alvo: fluxo único via `buildTool` injetado do domínio `tools/`. Não usar fallback paralelo para
 * `createToolSync`, evitando divergência de observabilidade/normalização.
 *
 * @returns {BuildToolFn}
 */
function requireCustomToolsBuilder() {
    if (_buildTool) return _buildTool;
    throw new Error(
        'Custom tools builder não injetado. Chame setCustomToolsBuilder(buildTool) no bootstrap antes de buildCustomTools().',
    );
}

/** Caminho canônico do arquivo de persistência. @type {string} */
const CUSTOM_TOOLS_PATH = resolvePersistentConfigFile('custom-tools.json');

/**
 * Lê o arquivo de registry no caminho canônico.
 *
 * @returns {Promise<string | null>}
 */
async function _readRegistryFile() {
    try {
        return await readFile(CUSTOM_TOOLS_PATH, 'utf8');
    } catch (e) {
        if (toError(e).code === 'ENOENT') return null;
        throw e;
    }
}

/**
 * @returns {string | null}
 */
function _readRegistryFileSync() {
    try {
        return readFileSync(CUSTOM_TOOLS_PATH, 'utf8');
    } catch (e) {
        if (toError(e).code === 'ENOENT') return null;
        throw e;
    }
}

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
        (/** @type {Record<string, unknown>} */ args) => {
            const text = typeof args['text'] === 'string' ? args['text'] : JSON.stringify(args);
            return `echo: ${text}`;
        },
    ],
    ['timestamp', () => new Date().toISOString()],
    [
        'env_read',
        (/** @type {Record<string, unknown>} */ args) => {
            const key = typeof args['key'] === 'string' ? args['key'] : '';
            if (!key) return '(key ausente)';
            // C12-02: allowlist explícita — bloquear exposição de tokens/secrets ao modelo
            const ENV_ALLOWLIST = new Set([
                'NODE_ENV',
                'COPILOT_WORKING_DIRECTORY',
                'COPILOT_DB_PATH',
                'TZ',
                'LANG',
                'HOSTNAME',
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
        (/** @type {Record<string, unknown>} */ args) => {
            const expr = typeof args['expression'] === 'string' ? args['expression'].trim() : '';
            if (!expr) return '(expressão ausente)';
            if (expr.length > 64) return '(expressão muito longa — limite: 64 caracteres)';
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
 * @property {Record<string, unknown> | undefined} [parameters] - JSON Schema dos parâmetros (opcional)
 */

/**
 * Registry em memória de custom tools declarativas.
 *
 * @type {Map<string, CustomToolDefinition>}
 */
let _registry = new Map();

/**
 * F92: Versão async de loadCustomTools — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
export async function loadCustomToolsAsync() {
    try {
        const raw = await _readRegistryFile();
        if (raw === null) {
            _registry = new Map();
            _loaded = true;
            log('DEBUG', '[custom-tools-registry] custom-tools.json ausente — registry vazio (opcional).');
            return;
        }
        const jsonResult = safeJsonParse(raw, '[custom-tools/loadCustomToolsAsync]');
        if (!jsonResult.ok) {
            _loaded = true;
            log('WARN', '[custom-tools-registry] custom-tools.json JSON inválido.');
            return;
        }
        const jsonData = /** @type {unknown} */ (jsonResult.data);
        const result = CustomToolsFileSchema.safeParse(jsonData);
        if (!result.success || !result.data) {
            _loaded = true;
            log('WARN', '[custom-tools-registry] custom-tools.json schema inválido — registry vazio.');
            return;
        }
        const items = result.data;
        _registry = new Map(items.map((item) => [item.name, item]));
        _loaded = true;
        log('INFO', `[custom-tools-registry] ${_registry.size} custom tool(s) carregadas do disco (async).`);
    } catch (e) {
        logSwallowed(e, 'sdk.customTools.loadRegistry');
        _loaded = true;
    }
}

/**
 * Carrega o registry de forma síncrona sob demanda, sem top-level await. Mantém `buildCustomTools()` síncrono sem
 * perder o carregamento inicial do arquivo persistido.
 *
 * @returns {void}
 */
function ensureCustomToolsLoadedSync() {
    if (_loaded) return;
    try {
        const raw = _readRegistryFileSync();
        if (raw === null) {
            _registry = new Map();
            _loaded = true;
            log('DEBUG', '[custom-tools-registry] custom-tools.json ausente — registry vazio (opcional).');
            return;
        }
        const jsonResult = safeJsonParse(raw, '[custom-tools/ensureCustomToolsLoadedSync]');
        if (!jsonResult.ok) {
            _loaded = true;
            log('WARN', '[custom-tools-registry] custom-tools.json JSON inválido.');
            return;
        }
        const result = CustomToolsFileSchema.safeParse(/** @type {unknown} */ (jsonResult.data));
        if (!result.success || !result.data) {
            _loaded = true;
            log('WARN', '[custom-tools-registry] custom-tools.json schema inválido — registry vazio.');
            return;
        }
        _registry = new Map(result.data.map((item) => [item.name, item]));
        _loaded = true;
        log('INFO', `[custom-tools-registry] ${_registry.size} custom tool(s) carregadas do disco (sync).`);
    } catch (e) {
        _loaded = true;
        logSwallowed(e, 'sdk.customTools.loadRegistrySync');
    }
}

/**
 * Inicializa o registry de custom tools sob demanda sem top-level await.
 *
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function initCustomTools(opts = {}) {
    if (opts.force || !_loadPromise) {
        _loadPromise = loadCustomToolsAsync();
    }
    return _loadPromise;
}

/**
 * F92: Versão async de persistCustomTools — usa fs/promises com write atômico.
 *
 * @returns {Promise<void>}
 */
function _persistCustomToolsAsync() {
    const content = `${JSON.stringify([..._registry.values()], null, 2)}\n`;
    _persistQueue = _persistQueue
        .catch(() => undefined)
        .then(() => writeFileAtomicTrusted(CUSTOM_TOOLS_PATH, content, { caller: 'sdk.tools.custom', mode: 0o600 }))
        .catch((err) => {
            log(
                'WARN',
                `[custom-tools-registry] Falha ao persistir custom-tools.json (async): ${toError(err).message}`,
            );
        });
    return _persistQueue;
}

/**
 * Retorna todas as definições de custom tools registradas.
 *
 * @returns {CustomToolDefinition[]}
 */
export function getCustomToolDefinitions() {
    ensureCustomToolsLoadedSync();
    return [..._registry.values()];
}

/**
 * Registra uma nova custom tool declarativa. Retorna erro se o `handlerId` não for reconhecido.
 *
 * @param {CustomToolDefinition} def
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
export async function registerCustomTool(def) {
    ensureCustomToolsLoadedSync();
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
    await _persistCustomToolsAsync();
    log('INFO', `[custom-tools-registry] Tool '${def.name}' registrada (handler: ${def.handlerId}).`);
    return { ok: true };
}

/**
 * Remove uma custom tool pelo nome.
 *
 * @param {string} name
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
export async function removeCustomTool(name) {
    ensureCustomToolsLoadedSync();
    if (!_registry.has(name)) {
        return { ok: false, error: `Tool '${name}' não encontrada.` };
    }
    _registry.delete(name);
    await _persistCustomToolsAsync();
    log('INFO', `[custom-tools-registry] Tool '${name}' removida.`);
    return { ok: true };
}

/**
 * Verifica se o custom tools builder foi injetado e está disponível.
 *
 * @returns {boolean}
 */
export function isCustomToolsBuilderReady() {
    return _buildTool !== null;
}

/**
 * Constrói instâncias `Tool` SDK a partir das definições registradas. Cada tool com `handlerId` inválido é ignorada com
 * warning (proteção contra corrupção do arquivo de persistência).
 *
 * @returns {import('@github/copilot-sdk').Tool[]}
 */
export function buildCustomTools() {
    ensureCustomToolsLoadedSync();
    const buildTool = requireCustomToolsBuilder();
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
                handler: async (/** @type {unknown} */ args) => {
                    const result = await handler(/** @type {Record<string, unknown>} */ (args));
                    return typeof result === 'string' ? result : JSON.stringify(result);
                },
            }),
        );
    }
    return tools;
}

/**
 * Reseta o estado interno do registry para isolamento de testes. **Não usar em produção.**
 *
 * @returns {void}
 * @internal
 */
export function _resetRegistry() {
    _loaded = false; // primeiro: impede que Promise em voo marque como loaded
    _loadPromise = null; // segundo: descarta referência da Promise em voo
    _registry = new Map(); // terceiro: limpa dados
}
