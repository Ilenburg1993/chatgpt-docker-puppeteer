// @ts-check
/**
 * src/copilot/core/sdk-types.js
 *
 * @module copilot/core/sdk-types
 * @deprecated Use `import('#copilot/sdk/types')` ou `import('../sdk/types.js')` em vez deste módulo. Este arquivo é
 *   mantido por backward compatibility e será removido em versão futura. A fonte canônica de tipos SDK agora é
 *   `src/copilot/sdk/types.js` (78+ tipos completos).
 * @see module:copilot/sdk/types
 */

/**
 * Cliente principal do SDK. Gerencia conexão, autenticação e criação de sessões.
 *
 * @typedef {import('#copilot/sdk/types.js').CopilotClient} CopilotClient
 */

/**
 * Sessão ativa do SDK. Expõe `sendAndWait`, `on`, event listeners e lifecycle.
 *
 * @typedef {import('#copilot/sdk/types.js').CopilotSession} CopilotSession
 */

/**
 * Configuração para criação de sessão (`client.startSession(config)`).
 *
 * @typedef {import('#copilot/sdk/types.js').SessionConfig} SessionConfig
 */

/**
 * Evento genérico da sessão SDK (união discriminada pelo campo `type`).
 *
 * @typedef {import('#copilot/sdk/types.js').SessionEvent} SessionEvent
 */

/**
 * Tipo de evento da sessão SDK (string literal union).
 *
 * @typedef {import('#copilot/sdk/types.js').SessionEventType} SessionEventType
 */

/**
 * Handler tipado para eventos da sessão SDK.
 *
 * @typedef {import('#copilot/sdk/types.js').SessionEventHandler} SessionEventHandler
 */

/**
 * Definição de tool para o SDK (retornada por `defineTool`).
 *
 * @typedef {import('#copilot/sdk/types.js').Tool} Tool
 */

/**
 * Handler de permissão do SDK. Recebe `PermissionRequest`, retorna `PermissionRequestResult`.
 *
 * @typedef {import('#copilot/sdk/types.js').PermissionHandler} PermissionHandler
 */

/**
 * Pedido de permissão emitido pelo SDK quando uma tool quer executar ação protegida.
 *
 * @typedef {import('#copilot/sdk/types.js').PermissionRequest} PermissionRequest
 */

/**
 * Resultado da decisão de permissão.
 *
 * @typedef {import('#copilot/sdk/types.js').PermissionRequestResult} PermissionRequestResult
 */

/**
 * Opções para `session.sendAndWait(message, options)`.
 *
 * @typedef {import('#copilot/sdk/types.js').MessageOptions} MessageOptions
 */

/**
 * Opções de conexão do CopilotClient.
 *
 * @typedef {import('#copilot/sdk/types.js').CopilotClientOptions} CopilotClientOptions
 */

/**
 * Configuração de sessão infinita (compaction).
 *
 * @typedef {import('#copilot/sdk/types.js').InfiniteSessionConfig} InfiniteSessionConfig
 */

/**
 * Opções para retomar sessão existente.
 *
 * @typedef {import('#copilot/sdk/types.js').ResumeSessionConfig} ResumeSessionConfig
 */

/**
 * Invocação de tool pelo SDK.
 *
 * @typedef {import('#copilot/sdk/types.js').ToolInvocation} ToolInvocation
 */

/**
 * Schema Zod usado pelo SDK para validação de parâmetros de tool.
 *
 * @template T
 * @typedef {import('#copilot/sdk/types.js').ZodSchema<T>} ZodSchema
 */

export {};
