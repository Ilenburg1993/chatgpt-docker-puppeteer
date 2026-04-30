// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-status
 * @file Façade canônica de leitura de status/health do runtime do agent.
 *
 *   Esta camada concentra o acesso às APIs públicas de snapshot do runtime (`getStatusSnapshot()` /
 *   `getHealthSnapshot()`) para que `presentation/` e outras bordas compartilhem um contrato estável sem depender do
 *   nome exato desses métodos em vários arquivos.
 *
 *   Regra de fronteira: esta façade lê estado observável do runtime; ela não deve montar payload HTTP, decidir status
 *   code, nem aplicar fallback de seleção de runtime. Essas decisões pertencem a `presentation/` e `server/`.
 */

export {
    readAgentRuntimeHealthSnapshot,
    readAgentRuntimeSdkResourceSnapshot,
    readAgentRuntimeStatusSnapshot,
    readAgentRuntimeStatusValue,
} from '../runtime/status-readers.js';
