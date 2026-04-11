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
 * @see EventBus
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';
import { safeJsonParse } from '../core/safe-json.js';
import { ToolsConfigSchema } from '../core/schemas.js';
import { log } from './logger.js';

/** Caminho do arquivo de persistência. @type {string} */
const TOOLS_CONFIG_PATH = join(resolve(import.meta.dirname, '../..'), 'tools-config.json');

/**
 * Configuração de ferramentas em runtime (allow/deny lists).
 *
 * @type {{ allowlist: string[] | null; denylist: string[] }}
 */
let _toolsConfig = { allowlist: null, denylist: [] };

/**
 * @deprecated F51: Removida. Use loadToolsConfigAsync(). Shim: delega para loadToolsConfigAsync() e ignora a Promise
 *   silenciosamente.
 * @returns {void}
 */
export function loadToolsConfig() {
    loadToolsConfigAsync().catch(() => {});
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
 * Atualiza parcialmente a configuração de ferramentas e persiste no disco (async).
 *
 * @param {{ allowlist?: string[] | null; denylist?: string[] }} updates
 * @returns {Promise<void>}
 */
export async function patchToolsConfig(updates) {
    if ('allowlist' in updates) {
        _toolsConfig = {
            ..._toolsConfig,
            allowlist: Array.isArray(updates.allowlist) ? [...updates.allowlist] : null,
        };
    }
    if ('denylist' in updates) {
        _toolsConfig = { ..._toolsConfig, denylist: updates.denylist ? [...updates.denylist] : [] };
    }
    await _persistToolsConfigAsync();
}
