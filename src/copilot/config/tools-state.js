// @ts-check
/**
 * src/copilot/config/tools-state.js
 *
 * AH.2 — Estado compartilhado de configuração de ferramentas (allowlist/denylist).
 * Módulo isolado para evitar dependências circulares entre session-manager.js e http-handlers.js.
 *
 * @module copilot/config/tools-state
 */

/**
 * Configuração de ferramentas em runtime (allow/deny lists).
 * Armazenada em memória — não persiste entre reinicializações.
 *
 * @type {{ allowlist: string[] | null; denylist: string[] }}
 */
let _toolsConfig = { allowlist: null, denylist: [] };

/**
 * Retorna uma cópia da configuração atual de ferramentas.
 *
 * @returns {{ allowlist: string[] | null; denylist: string[] }}
 */
export function getToolsConfig() {
    return { ..._toolsConfig };
}

/**
 * Atualiza parcialmente a configuração de ferramentas.
 *
 * @param {{ allowlist?: string[] | null; denylist?: string[] }} updates
 * @returns {void}
 */
export function patchToolsConfig(updates) {
    if ('allowlist' in updates) {
        _toolsConfig = { ..._toolsConfig, allowlist: updates.allowlist ?? null };
    }
    if ('denylist' in updates) {
        _toolsConfig = { ..._toolsConfig, denylist: updates.denylist ?? [] };
    }
}
