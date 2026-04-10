// @ts-check
/**
 * src/copilot/config/tools-state.js
 *
 * AH.2 — Estado compartilhado de configuração de ferramentas (allowlist/denylist). Módulo isolado para evitar
 * dependências circulares entre session-manager.js e http-handlers.js.
 *
 * AI.1 — Persistência em `tools-config.json` na raiz do projeto. Carregado no boot via `loadToolsConfig()`; gravado a
 * cada `patchToolsConfig()` para sobreviver a restarts.
 *
 * @module copilot/config/tools-state
 */

import { log } from '#copilot/observability/logger';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';
import { safeJsonParse } from '../core/safe-json.js';
import { ToolsConfigSchema } from '../core/schemas.js';

/** Caminho do arquivo de persistência. @type {string} */
const TOOLS_CONFIG_PATH = join(resolve(import.meta.dirname, '../..'), 'tools-config.json');

/**
 * Configuração de ferramentas em runtime (allow/deny lists).
 *
 * @type {{ allowlist: string[] | null; denylist: string[] }}
 */
let _toolsConfig = { allowlist: null, denylist: [] };

/**
 * Carrega a configuração de ferramentas do disco. Deve ser chamada na inicialização do agente. Idempotente — se o
 * arquivo não existir ou estiver inválido, mantém os defaults em memória.
 *
 * @deprecated F92: Use loadToolsConfigAsync() em fluxos assíncronos.
 * @returns {void}
 */
export function loadToolsConfig() {
    // FS-SYNC: init-time-safe (deprecated sync fallback)
    if (!existsSync(TOOLS_CONFIG_PATH)) return;
    try {
        const raw = readFileSync(TOOLS_CONFIG_PATH, 'utf8');
        const result = safeJsonParse(raw, '[tools-state/loadToolsConfig]');
        const parsed = /** @type {unknown} */ (result.ok ? result.data : null);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const data = /** @type {Record<string, unknown>} */ (parsed);
            const allowlist =
                data['allowlist'] === null || Array.isArray(data['allowlist'])
                    ? /** @type {string[] | null} */ (data['allowlist'])
                    : null;
            const denylist = Array.isArray(data['denylist']) ? /** @type {string[]} */ (data['denylist']) : [];
            _toolsConfig = { allowlist, denylist };
            log(
                'INFO',
                `[tools-state] Configuração carregada: ${allowlist ? allowlist.length + ' ferramentas na allowlist' : 'sem allowlist'}, ${denylist.length} na denylist`,
            );
        }
    } catch (/** @type {any} */ err) {
        log('WARN', `[tools-state] Falha ao carregar tools-config.json: ${err.message}`);
    }
}

/**
 * Persiste a configuração atual de ferramentas no disco.
 *
 * @deprecated F92: Use persistToolsConfigAsync() em fluxos assíncronos.
 * @returns {void}
 */
function persistToolsConfig() {
    // FS-SYNC: init-time-safe (deprecated sync fallback)
    try {
        writeFileSync(TOOLS_CONFIG_PATH, JSON.stringify(_toolsConfig, null, 2), 'utf8');
    } catch (/** @type {any} */ err) {
        log('WARN', `[tools-state] Falha ao persistir tools-config.json: ${err.message}`);
    }
}

/**
 * F92: Versão async de loadToolsConfig — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
export async function loadToolsConfigAsync() {
    try {
        const raw = await readFile(TOOLS_CONFIG_PATH, 'utf8');
        const jsonResult = safeJsonParse(raw, '[tools-state/loadToolsConfigAsync]');
        if (!jsonResult.ok) {
            log('WARN', '[tools-state] tools-config.json JSON inválido — mantendo defaults.');
            return;
        }
        const jsonData = /** @type {unknown} */ (jsonResult.data);
        const result = ToolsConfigSchema.safeParse(jsonData);
        if (result.success && result.data) {
            _toolsConfig = { allowlist: result.data.allowlist, denylist: result.data.denylist };
            const { allowlist, denylist } = _toolsConfig;
            log(
                'INFO',
                `[tools-state] Configuração carregada (async): ${allowlist ? allowlist.length + ' ferramentas na allowlist' : 'sem allowlist'}, ${denylist.length} na denylist`,
            );
        } else {
            log('WARN', '[tools-state] tools-config.json schema inválido — mantendo defaults.');
        }
    } catch (/** @type {any} */ e) {
        logSwallowed(e, 'sdk.toolsState.loadConfig');
    }
}

/**
 * F92: Versão async de persistToolsConfig — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
async function _persistToolsConfigAsync() {
    try {
        await writeFile(TOOLS_CONFIG_PATH, JSON.stringify(_toolsConfig, null, 2), 'utf8');
    } catch (/** @type {any} */ err) {
        log('WARN', `[tools-state] Falha ao persistir tools-config.json (async): ${err.message}`);
    }
}

/**
 * Retorna uma cópia da configuração atual de ferramentas.
 *
 * @returns {{ allowlist: string[] | null; denylist: string[] }}
 */
export function getToolsConfig() {
    return {
        allowlist: Array.isArray(_toolsConfig.allowlist) ? [..._toolsConfig.allowlist] : null,
        denylist: [..._toolsConfig.denylist],
    };
}

/**
 * Atualiza parcialmente a configuração de ferramentas e persiste no disco.
 *
 * @param {{ allowlist?: string[] | null; denylist?: string[] }} updates
 * @returns {void}
 */
export function patchToolsConfig(updates) {
    if ('allowlist' in updates) {
        _toolsConfig = {
            ..._toolsConfig,
            allowlist: Array.isArray(updates.allowlist) ? [...updates.allowlist] : null,
        };
    }
    if ('denylist' in updates) {
        _toolsConfig = { ..._toolsConfig, denylist: updates.denylist ? [...updates.denylist] : [] };
    }
    persistToolsConfig();
}
