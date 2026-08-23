// @ts-check
/**
 * @module copilot/agent/ports
 * @file Portas de composição usadas pelo runtime do agent.
 *
 *   Esta pasta é a fronteira autorizada entre `agent/` e capacidades de outras áreas (`tools/`, `hooks/`, `bridges/`,
 *   `conversation-hub/`, `observability/`). Arquivos de lifecycle, session, dialog e state devem importar destas portas
 *   quando precisarem de uma integração externa, em vez de atravessar diretamente para a implementação concreta.
 *
 *   Regra prática para novas ampliações:
 *
 *   - se a dependência externa é necessária para o runtime iniciar ou operar, crie/expanda uma porta aqui;
 *   - se o código só formata resposta para HTTP/terminal, a integração pertence a `presentation/`;
 *   - se a dependência representa capability pública do runtime, exponha também uma façade em `agent/facades/`.
 *
 * @internal
 */

export * from './conversation-port.js';
export * from './error-tracking-port.js';
export * from './event-observer-port.js';
export * from './hook-port.js';
export * from './logging/index.js';
export * from './mcp-port.js';
export * from './metrics-port.js';
export * from './observability-port.js';
export * from './permission-port.js';
export * from './sdk-preflight-port.js';
export * from './snapshot-port.js';
export * from './todo-port.js';
export * from './tool-port.js';
export * from './tool-surface-policy-port.js';
export * from './tracing-port.js';
export * from './user-input-policy-port.js';

export { setAgentSessionModel } from './session-runtime-port.js';
