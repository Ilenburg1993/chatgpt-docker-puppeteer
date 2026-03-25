// @ts-check
/**
 * src/copilot/channel/index.js
 *
 * Módulo canal LLM-A ↔ LLM-B — ponto de entrada canônico para toda comunicação entre LLM-A (GitHub Copilot — este
 * agente) e LLM-B (Copilot SDK / gpt-4.1).
 *
 * Consolida dois modos de comunicação:
 *
 * - **HTTP injection** (`inject.js`): via `POST /inject` ao terminal server ativo (porta 3009). Recomendado quando o
 *   terminal já está rodando (`npm run terminal:llm-b`).
 * - **SDK client** (`client.js`): via `AlwaysAliveAgent` em-processo, com streaming e histórico. Usado em scripts
 *   standalone que iniciam a sessão SDK diretamente.
 *
 * @module copilot/channel
 *
 * @example
 *     ```js
 *     // Modo HTTP injection (terminal já ativo)
 *     import { checkLlmBHealth, injectToLlmB } from '#copilot/channel';
 *
 *     const { ready } = await checkLlmBHealth();
 *     if (ready) {
 *         const { reply } = await injectToLlmB('Analise src/copilot/ e liste melhorias.');
 *         console.log(reply);
 *     }
 *
 *     // Modo SDK client (standalone)
 *     import { LlmBridgeClient } from '#copilot/channel';
 *     import { alwaysAliveAgent } from '#copilot/*';
 *
 *     await alwaysAliveAgent.start();
 *     const bridge = new LlmBridgeClient();
 *     const result = await bridge.chat('Olá LLM-B!');
 *     await alwaysAliveAgent.stop();
 *     ```;
 */

// ─── Versão do protocolo de canal ─────────────────────────────────────────────

/**
 * Versão do protocolo de comunicação do canal LLM-A ↔ LLM-B.
 *
 * Incrementar quando houver mudanças incompatíveis na API pública.
 *
 * @type {string}
 */
export const CHANNEL_VERSION = '1';

// ─── HTTP Injection (modo terminal ativo) ──────────────────────────────────────

export {
    checkLlmBHealth,
    injectPipeline,
    injectToLlmB,
    subscribeLlmB,
    subscribeLlmBCritical,
    waitForLlmBReady,
} from './inject.js';

// ─── SDK Client (modo standalone / em-processo) ────────────────────────────────

export { LlmBridgeClient, llmBridgeClient } from './client.js';

// ─── Tool Call Auditing ────────────────────────────────────────────────────────

export { auditToolComplete, auditToolStart, getAuditSummary } from './audit.js';

// ─── Tipos públicos do canal ───────────────────────────────────────────────────

/**
 * Tipo de anexo aceito pelo canal LLM-A ↔ LLM-B.
 *
 * Mapeia diretamente para `MessageOptions['attachments']` do SDK, suportando arquivos, diretórios e seleções de texto.
 *
 * @typedef {import('@github/copilot-sdk').MessageOptions['attachments']} ChannelAttachment
 */
