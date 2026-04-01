// @ts-check
/**
 * src/copilot/types/sdk.js
 *
 * Re-exportação centralizada dos tipos do `@github/copilot-sdk` mais usados em `src/copilot/`.
 *
 * Em vez de repetir `import('@github/copilot-sdk').CopilotSession` em dezenas de arquivos, cada módulo pode usar
 * `import('./types/sdk.js').CopilotSession` (ou o alias).
 *
 * Este módulo **não contém runtime** — é puro barrel de tipos para JSDoc.
 *
 * @module copilot/types/sdk
 */

/**
 * Cliente principal do SDK. Gerencia conexão, autenticação e criação de sessões.
 *
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 */

/**
 * Sessão ativa do SDK. Expõe `sendAndWait`, `on`, event listeners e lifecycle.
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * Configuração para criação de sessão (`client.startSession(config)`).
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 */

/**
 * Evento genérico da sessão SDK (união discriminada pelo campo `type`).
 *
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
 */

/**
 * Tipo de evento da sessão SDK (string literal union).
 *
 * @typedef {import('@github/copilot-sdk').SessionEventType} SessionEventType
 */

/**
 * Handler tipado para eventos da sessão SDK.
 *
 * @typedef {import('@github/copilot-sdk').SessionEventHandler} SessionEventHandler
 */

/**
 * Definição de tool para o SDK (retornada por `defineTool`).
 *
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 */

/**
 * Handler de permissão do SDK. Recebe `PermissionRequest`, retorna `PermissionRequestResult`.
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 */

/**
 * Pedido de permissão emitido pelo SDK quando uma tool quer executar ação protegida.
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest
 */

/**
 * Resultado da decisão de permissão.
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult
 */

/**
 * Opções para `session.sendAndWait(message, options)`.
 *
 * @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions
 */

/**
 * Opções de conexão do CopilotClient.
 *
 * @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions
 */

/**
 * Configuração de sessão infinita (compaction).
 *
 * @typedef {import('@github/copilot-sdk').InfiniteSessionConfig} InfiniteSessionConfig
 */

/**
 * Opções para retomar sessão existente.
 *
 * @typedef {import('@github/copilot-sdk').ResumeSessionConfig} ResumeSessionConfig
 */

/**
 * Invocação de tool pelo SDK.
 *
 * @typedef {import('@github/copilot-sdk').ToolInvocation} ToolInvocation
 */

/**
 * Schema Zod usado pelo SDK para validação de parâmetros de tool.
 *
 * @template T
 * @typedef {import('@github/copilot-sdk').ZodSchema<T>} ZodSchema
 */

export {};
