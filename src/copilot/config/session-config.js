// @ts-check
/**
 * src/copilot/config/session-config.js — [L2] Constantes e defaults de sessão.
 *
 * Profile builders (buildAlwaysAliveConfig, buildReadOnlyConfig, etc.) foram movidos para `hooks/presets/profiles.js`
 * (L3) pois dependem de hooks. Cf. PARTE-21C Faixa H.
 *
 * @module copilot/config/session-config
 * @see EventBus
 * @see module:copilot/hooks/presets/profiles
 */

/**
 * @typedef {import('#copilot/sdk/types').SessionConfig} SessionConfig
 *
 * @typedef {import('#copilot/sdk/types').Tool} Tool
 *
 * @typedef {import('#copilot/sdk/types').PermissionHandler} PermissionHandler
 */

/**
 * AH.1 — Ferramentas excluídas por padrão em sessões always-alive.
 *
 * Estas tools introduzem riscos de segurança ou são irrelevantes para o fluxo principal:
 *
 * - `powershell`: execução arbitrária de comandos no Windows
 * - `web_fetch`: exfiltração potencial de dados via HTTP não auditado
 * - `web_search`: buscas não controladas em produção
 * - `memory`: manipulação de memória persistente via ferramenta lateral
 *
 * @type {readonly string[]}
 */
export const DEFAULT_EXCLUDED_TOOLS = /** @type {readonly string[]} */ (
    Object.freeze(['powershell', 'web_fetch', 'web_search', 'memory'])
);
