// @ts-check
/**
 * src/copilot/core/constants.js
 *
 * Constantes centralizadas do módulo copilot.
 *
 * Centraliza valores literais que antes estavam espalhados (portas, limites, nomes de eventos) para facilitar
 * manutenção e tipagem.
 *
 * @module copilot/core/constants
 */

/**
 * Porta padrão do terminal LLM-B (servidor HTTP raw + endpoint /inject). Pode ser sobrescrita via variável de ambiente
 * `LLM_B_TERMINAL_PORT`.
 *
 * @type {number}
 */
export const LLM_B_TERMINAL_PORT = 3009;

/**
 * Tamanho máximo da fila de mensagens do AlwaysAliveAgent. Quando a fila atinge este limite, novas mensagens são
 * rejeitadas.
 *
 * @type {number}
 */
export const MAX_QUEUE_SIZE = 100;

/**
 * Timeout padrão de turno LLM-B em ms. Pode ser sobrescrito via `LLM_B_TURN_TIMEOUT_MS` (preferido) ou
 * `LLM_B_TURN_TIMEOUT` (legado, aceito por compatibilidade). Usado por dialog.js (terminal REPL) e channel/inject.js
 * (injeção HTTP).
 *
 * GAP-CORE-001 fix: suporte às duas formas de env var — prefere a versão `_MS` para nomenclatura inequívoca; mantém
 * `LLM_B_TURN_TIMEOUT` por compatibilidade retroativa.
 *
 * @type {number}
 */
export const LLM_B_TURN_TIMEOUT_MS = Number(
    process.env['LLM_B_TURN_TIMEOUT_MS'] ?? process.env['LLM_B_TURN_TIMEOUT'] ?? 120_000,
);

/**
 * Número máximo de clientes SSE simultâneos por endpoint. Evita leak de memória quando muitos clientes SSE abrem
 * conexões sem fechá-las.
 *
 * @type {number}
 */
export const MAX_SSE_CLIENTS = Number(process.env['MAX_SSE_CLIENTS'] ?? 50);

/**
 * Tamanho máximo em caracteres de um chunk de conteúdo SSE antes de truncamento. Evita mensagens de eventos SSE
 * excessivamente grandes que podem causar problemas em buffers de proxy/cliente. Configurável via variável de ambiente
 * MAX_SSE_CONTENT_CHARS.
 *
 * @type {number}
 */
export const MAX_SSE_CONTENT_CHARS = Number(process.env['MAX_SSE_CONTENT_CHARS'] ?? 64_000);

/**
 * Nomes canônicos de eventos emitidos pelo AlwaysAliveAgent. Re-exportados de agent/events.js para acesso centralizado
 * via core/.
 *
 * @type {readonly string[]}
 */
export { AGENT_EVENTS } from '../agent/events.js';
/** @typedef {import('../agent/events.js').AgentEventName} AgentEventName */

/**
 * G1-DX-04: Nomes canônicos de categoria de ferramentas registradas em tools-bootstrap.js. Usar estas constantes em vez
 * de strings literais ao registrar novas ferramentas.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TOOL_CATEGORIES = Object.freeze({
    TASK: 'task',
    CODE: 'code',
    GIT: 'git',
    SESSION: 'session',
    SESSION_RPC: 'session-rpc',
    HOOK: 'hook',
    HUB: 'hub',
    INTROSPECTION: 'introspection',
    FILE: 'file',
    SHELL: 'shell',
    WEB: 'web',
    TODO: 'todo',
    PERMISSION: 'permission',
    MCP: 'mcp',
    CUSTOM: 'custom',
});
