// @ts-check
/**
 * src/copilot/channel/index.js
 *
 * Módulo canal LLM-A ↔ LLM-B — ponto de entrada canônico para toda comunicação entre LLM-A (GitHub Copilot — este
 * agente) e LLM-B (Copilot SDK / modelo configurado, default `gpt-5-mini`).
 *
 * Consolida dois modos de comunicação:
 *
 * - **HTTP injection** (`inject.js`): via `POST /inject` ao terminal server ativo (porta 3009). Recomendado quando o
 *   terminal já está rodando (`npm run terminal:llm-b`).
 * - **SDK client** (`client.js`): via `AlwaysAliveAgent` em-processo, com streaming e histórico. Usado em scripts
 *   standalone que iniciam a sessão SDK diretamente.
 *
 * @module copilot/channel
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
 *     import { getAgent } from '#copilot/agent';
 *
 *     const agent = getAgent();
 *     await agent.start();
 *     const bridge = new LlmBridgeClient();
 *     const result = await bridge.chat('Olá LLM-B!');
 *     await agent.stop();
 *     ```;
 *
 * @see EventBus
 */

// ─── Versão do protocolo de canal ─────────────────────────────────────────────

/**
 * Versão do protocolo de comunicação do canal LLM-A ↔ LLM-B.
 *
 * Incrementar quando houver mudanças incompatíveis na API pública.
 *
 * UPG-07: versão semver — MAJOR.MINOR.PATCH
 *
 * - MAJOR: mudanças incompatíveis no protocolo StructuredMessage
 * - MINOR: novas features backward-compatible
 * - PATCH: bugfixes e melhorias internas
 *
 * @type {string}
 */
export const CHANNEL_VERSION = '1.3.0';

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

// ─── Tipos públicos do canal ───────────────────────────────────────────────────

/**
 * Tipo de anexo aceito pelo canal LLM-A ↔ LLM-B.
 *
 * Mapeia diretamente para `MessageOptions['attachments']` do SDK, suportando arquivos, diretórios e seleções de texto.
 *
 * @typedef {import('#copilot/sdk/types').MessageOptions['attachments']} ChannelAttachment
 */
