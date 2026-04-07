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
import { join, resolve } from 'node:path';

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
 * @returns {void}
 */
export function loadToolsConfig() {
    if (!existsSync(TOOLS_CONFIG_PATH)) return;
    try {
        const raw = readFileSync(TOOLS_CONFIG_PATH, 'utf8');
        const parsed = /** @type {unknown} */ (JSON.parse(raw));
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
 * @returns {void}
 */
function persistToolsConfig() {
    try {
        writeFileSync(TOOLS_CONFIG_PATH, JSON.stringify(_toolsConfig, null, 2), 'utf8');
    } catch (/** @type {any} */ err) {
        log('WARN', `[tools-state] Falha ao persistir tools-config.json: ${err.message}`);
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
