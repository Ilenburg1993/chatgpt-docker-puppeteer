// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as contextCore from './context/context_core.js';

/**
 * Resolve referências de contexto em texto (ex: {{REF:task_id}}). Substitui referências por conteúdo de tarefas
 * anteriores com transformações opcionais. Side-effects: Lê arquivos de resposta de tarefas, aplica orçamentos e
 * validações de segurança.
 *
 * @param {string} text - Texto contendo referências a resolver.
 * @param {object} [currentTask=null] - Tarefa atual para evitar auto-referência. Default is `null`
 * @param {AbortSignal} [signal=null] - Sinal para cancelamento assíncrono. Default is `null`
 * @param {number} [depth=0] - Profundidade de recursão atual. Default is `0`
 * @param {object} [budget=null] - Gestor de orçamento para controle de volume. Default is `null`
 * @returns {Promise<string>} Texto com referências resolvidas.
 * @throws {Error} Pode lançar 'CONTEXT_RESOLUTION_ABORTED' se sinal abortado, ou outros erros de resolução.
 */
export const resolveContext = contextCore.resolveContext;
