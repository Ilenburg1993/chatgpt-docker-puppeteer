// @ts-check
import { getAuditTail } from '#copilot/audit';
import { normalizeUserInputBridgeContract, toError } from '#copilot/core';
import { readText } from '#copilot/infra/public/io';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
/**
 * src/copilot/tools/hook/hook-tools.js
 *
 * Custom Tools que expõem o hook system do projeto ao Always-Alive Agent (LLM-B).
 *
 * Responsabilidades:
 *
 * - `hook_get_audit_tail` — lê as últimas N linhas do audit.jsonl para diagnóstico
 * - `request_user_input` — wrapper de pergunta estruturada para decisões humanas explícitas; não substitui o protocolo
 *   vivo `ask_user` READY/REPLY do terminal LLM-B.
 *
 * **ARQUITETURA DO `request_user_input`**: O SDK Copilot inclui nativamente a tool `ask_user` que chama
 * `onUserInputRequest`. Esta tool `request_user_input` é um wrapper semântico mais rico — com campo `choices` tipado e
 * `context` para o usuário entender o estado atual. Quando o agente LLM-B a invoca, o retorno é o input recebido via
 * `POST /api/copilot/answer` (ou equivalente na interface ativa). A continuidade ordinária do terminal permanente
 * permanece no `ask_user`; esta tool só deve ser chamada quando uma decisão estruturada for realmente necessária.
 *
 * @module copilot/tools/hook/hook-tools
 * @see EventBus
 * @see module:copilot/lib/hooks
 * @see module:copilot/hooks/audit
 */

import {
    cancelAllPendingStructuredUserInput,
    deletePendingStructuredUserInputResolver,
    getPendingStructuredUserInputCount,
    getPendingStructuredUserInputIds,
    getPendingStructuredUserInputRequests,
    hasPendingStructuredUserInputRequests as hasPendingStructuredUserInputRequestsState,
    nextStructuredUserInputRequestId,
    registerPendingStructuredUserInputResolver,
    resolvePendingStructuredUserInput,
    ToolSessionContext,
} from '#copilot/sdk/session';
const execFileAsync = promisify(execFile);

/**
 * @typedef {object} StructuredInputRequestSnapshot
 * @property {string} requestId
 * @property {string} question
 * @property {string[]} choices
 * @property {boolean} allowFreeform
 * @property {number} createdAt
 * @property {string | null} sessionId
 * @property {string | null} toolCallId
 * @property {Record<string, unknown>} data
 */

/**
 * Raiz do repositório — calculada em relação a este arquivo (src/copilot/tools/).
 *
 * @type {string}
 */
const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../');

/**
 * Diretório de estado do hook system.
 *
 * @type {string}
 */
const HOOK_STATE_DIR = join(ROOT, '.github', 'hooks', 'state');

// ─── ARCH-03: Injeção de broadcastSse para evitar dependência circular ────────

/**
 * Callback de broadcast SSE injetado via `configureHookTools()`. Fallback: no-op até que o terminal seja inicializado.
 *
 * @type {(event: string, data: Record<string, unknown>) => void}
 */
let _broadcastSse = () => {};

/**
 * `ToolSessionContext` injetado opcionalmente via `configureHookTools()`. Quando presente, o estado de input pendente é
 * encapsulado por sessão (em vez de usar singletons globais).
 *
 * @type {ToolSessionContext | null}
 */
let _toolSessionContext = null;

/**
 * Injeta a função `broadcastSse` para evitar import circular com a borda de diálogo do terminal. Deve ser chamado em
 * `runtime-wiring.js` durante o boot canônico antes de iniciar o agente.
 *
 * @param {{
 *     broadcastSse?: (event: string, data: Record<string, unknown>) => void;
 *     toolSessionContext?: ToolSessionContext;
 * }} config
 * @returns {void}
 */
export function configureHookTools({ broadcastSse, toolSessionContext } = {}) {
    if (typeof broadcastSse === 'function') {
        _broadcastSse = broadcastSse;
    }
    if (toolSessionContext instanceof ToolSessionContext) {
        _toolSessionContext = toolSessionContext;
        // Repassa broadcastSse para o context (caso seja configurado antes ou depois)
        if (typeof broadcastSse === 'function') {
            _toolSessionContext.configureBroadcastSse(broadcastSse);
        }
    }
}

// ─── Helpers internos com suporte a ToolSessionContext ───────────────────────

/** @returns {number} */
function _getPendingInputCount() {
    return _toolSessionContext ? _toolSessionContext.getPendingInputCount() : getPendingStructuredUserInputCount();
}

/** @returns {string[]} */
function _getPendingInputIds() {
    return _toolSessionContext ? _toolSessionContext.getPendingInputIds() : getPendingStructuredUserInputIds();
}

/** @returns {StructuredInputRequestSnapshot[]} */
function _getPendingInputRequests() {
    return _toolSessionContext ? _toolSessionContext.getPendingInputRequests() : getPendingStructuredUserInputRequests();
}

/** @returns {string} */
function _nextInputId() {
    return _toolSessionContext ? _toolSessionContext.nextStructuredInputId() : nextStructuredUserInputRequestId();
}

/**
 * @param {string} requestId
 * @param {(answer: string) => void} resolve
 * @param {Partial<Omit<StructuredInputRequestSnapshot, 'requestId' | 'sessionId'>>} [request]
 */
function _registerPendingInput(requestId, resolve, request = {}) {
    if (_toolSessionContext) {
        _toolSessionContext.registerPendingInput(requestId, resolve, request);
    } else {
        registerPendingStructuredUserInputResolver(requestId, resolve, request);
    }
}

/**
 * @param {string} requestId
 * @returns {boolean}
 */
function _deletePendingInput(requestId) {
    return _toolSessionContext
        ? _toolSessionContext.deletePendingInput(requestId)
        : deletePendingStructuredUserInputResolver(requestId);
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} data
 */
function _broadcast(event, data) {
    if (_toolSessionContext) {
        _toolSessionContext.broadcastSse(event, data);
    } else {
        try {
            _broadcastSse(event, data);
        } catch (_) {
            /* ignora */
        }
    }
}

/**
 * ARCH-N01: Registra uma resposta para a tool request_user_input pendente. Resolve a Promise do request mais antigo
 * ainda pendente (FIFO).
 *
 * @param {string} answer - Resposta do usuário
 * @param {string} [requestId] - ID específico do request (opcional; se omitido, resolve o mais antigo)
 * @returns {boolean} true se havia uma Promise pendente resolvida, false se fila vazia
 */
export function resolveUserInput(answer, requestId) {
    if (_toolSessionContext) return _toolSessionContext.resolveStructuredInput(answer, requestId);
    return resolvePendingStructuredUserInput(answer, requestId);
}

/**
 * Retorna os IDs dos requests de input atualmente pendentes.
 *
 * @returns {string[]}
 */
export function getPendingInputIds() {
    return _getPendingInputIds();
}

/**
 * Retorna snapshots completos dos requests estruturados pendentes.
 *
 * @returns {StructuredInputRequestSnapshot[]}
 */
export function getPendingInputRequests() {
    return _getPendingInputRequests();
}

/**
 * Indica se há ao menos uma chamada `request_user_input` suspensa aguardando resposta humana.
 *
 * Usado pela borda terminal para rotear uma linha digitada pelo operador para a Promise suspensa antes de abrir um
 * turno novo. Isso evita o congelamento aparente em que a LLM-B fica aguardando a tool enquanto o terminal trata a
 * resposta como mensagem comum.
 *
 * @returns {boolean}
 */
export function hasPendingUserInputRequests() {
    return _toolSessionContext ? _toolSessionContext.hasPendingInputs() : hasPendingStructuredUserInputRequestsState();
}

/**
 * Cancela todas as solicitações estruturadas pendentes de input do usuário.
 *
 * Usado no teardown de sessão para evitar Promises órfãs quando o runtime encerra com `request_user_input` em
 * andamento.
 *
 * @param {string} [answer='Sessão encerrada antes da resposta do usuário.'] Default is `'Sessão encerrada antes da
 *   resposta do usuário.'`. Default is `'Sessão encerrada antes da resposta do usuário.'`
 * @returns {number}
 */
export function cancelAllUserInputRequests(answer = 'Sessão encerrada antes da resposta do usuário.') {
    if (_toolSessionContext) return _toolSessionContext.cancelAllPendingInput(answer);
    return cancelAllPendingStructuredUserInput(answer);
}

// ─── Tool: hook_get_audit_tail ────────────────────────────────────────────────

/**
 * Tool: hook_get_audit_tail
 *
 * Retorna as últimas N entradas de auditoria de tool calls SDK. Fonte primária: ring buffer interno em
 * `src/copilot/hooks/audit.js` (Gap 10 do roadmap — isolamento dos sistemas SDK e operacional). Fallback: lê
 * `.github/hooks/state/audit.jsonl` (compliance operacional) quando o ring buffer está vazio, para compatibilidade
 * retroativa.
 */
const hookGetAuditTailTool = buildTool({
    name: 'hook_get_audit_tail',
    description:
        'Lê as últimas entradas de auditoria de chamadas de ferramentas SDK. ' +
        'Útil para verificar o histórico de tool calls, detectar ferramentas de alto risco e diagnosticar comportamento do agente.',
    parameters: z.object({
        lines: z
            .number()
            .int()
            .min(1)
            .optional()
            .default(20)
            .describe('Número sugerido de linhas a retornar (padrão histórico: 20)'),
        source: z
            .enum(['sdk', 'compliance', 'auto'])
            .optional()
            .default('auto')
            .describe(
                'Fonte: "sdk" = ring buffer interno (tool calls SDK), "compliance" = audit.jsonl operacional (.github/hooks/), "auto" = sdk primeiro, compliance como fallback',
            ),
    }),
    handler: async (/** @type {{ lines?: number; source?: 'sdk' | 'compliance' | 'auto' }} */ { lines, source }) => {
        const n = lines ?? 20;
        const src = source ?? 'auto';

        // Fonte primária: ring buffer do SDK (Gap 10 — isolamento)
        if (src === 'sdk' || src === 'auto') {
            const sdkEntries = getAuditTail(n);
            if (sdkEntries.length > 0 || src === 'sdk') {
                log('INFO', `[hook-tools/get_audit_tail] Retornando ${sdkEntries.length} entradas do ring buffer SDK.`);
                return { entries: sdkEntries, total: sdkEntries.length, source: 'sdk' };
            }
        }

        // Fallback: audit.jsonl do sistema operacional de compliance (.github/hooks/state/)
        const auditPath = join(HOOK_STATE_DIR, 'audit.jsonl');
        let auditExists = false;
        try {
            await access(auditPath);
            auditExists = true;
        } catch {
            // file does not exist
        }
        if (!auditExists) {
            log('WARN', '[hook-tools/get_audit_tail] Ring buffer vazio e audit.jsonl não encontrado.');
            return { entries: [], total: 0, source: 'none', note: 'Nenhuma fonte de auditoria disponível.' };
        }
        try {
            const { stdout: raw } = await execFileAsync('tail', ['-n', String(n), auditPath], {
                encoding: 'utf8',
                timeout: 3000,
            });
            const entries = raw
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                    try {
                        return JSON.parse(line);
                    } catch {
                        return { raw: line };
                    }
                });
            log(
                'INFO',
                `[hook-tools/get_audit_tail] Retornando ${entries.length} entradas do audit.jsonl (compliance).`,
            );
            return { entries, total: entries.length, source: 'compliance' };
        } catch (e) {
            log('WARN', `[hook-tools/get_audit_tail] Erro ao ler audit.jsonl: ${toError(e).message}`);
            return { entries: [], total: 0, source: 'none', error: toError(e).message };
        }
    },
});

// ─── Tool: request_user_input ─────────────────────────────────────────────────

/**
 * Tool: request_user_input
 *
 * Implementa o padrão "vscode_askQuestions" para LLM-B.
 *
 * INSTRUÇÕES AO MODELO: use esta tool quando precisar de uma decisão humana estruturada. No terminal LLM-B, a
 * continuidade ordinária da conversa é responsabilidade do protocolo nativo `ask_user` READY/REPLY.
 *
 * Quando invocada, o SDK suspende a execução via onUserInputRequest até que o usuário responda via POST
 * /api/copilot/answer (ou interface equivalente).
 */
const requestUserInputTool = buildTool({
    name: 'request_user_input',
    description:
        'Solicita input interativo ao usuário. ' +
        'Use apenas quando precisar de uma decisão humana estruturada, com pergunta e opções. ' +
        'No terminal LLM-B, não chame automaticamente ao fim de toda resposta; a continuidade normal usa ask_user READY/REPLY. ' +
        'É compatível com o padrão vscode_askQuestions do protocolo de hooks quando esse fluxo estiver ativo.',
    parameters: z.object({
        question: z.string().describe('Pergunta principal ao usuário (clara e objetiva)'),
        context: z.string().optional().describe('Contexto adicional — resumo do que foi feito para o usuário avaliar'),
        choices: z
            .array(z.string())
            .optional()
            .describe('Opções predefinidas. Se fornecido, o usuário escolhe entre estas opções ou escreve texto livre'),
        requires_selection: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, o usuário DEVE escolher uma das choices (sem texto livre)'),
    }),
    handler: async (
        /** @type {{ question: string; context?: string; choices?: string[]; requires_selection?: boolean }} */ {
            question,
            context,
            choices,
            requires_selection,
        },
    ) => {
        const MAX_CONTEXT_CHARS = 2000;
        const safeContext =
            typeof context === 'string' && context.trim().length > 0
                ? context.slice(0, MAX_CONTEXT_CHARS).replace(/\n{3,}/g, '\n\n')
                : undefined;
        const fullQuestion = safeContext ? `${question}\n\n**Contexto**: ${safeContext}` : question;
        const allowFreeform = !requires_selection;

        log('INFO', `[hook-tools/request_user_input] Pergunta: "${fullQuestion.slice(0, 100)}"`);

        // ARCH-N01 (fix): suspensão real — a Promise só resolve quando resolveUserInput() for chamado,
        // o que ocorre via answerPendingQuestion() no agente (POST /api/copilot/answer).
        // Isso garante que o modelo não continua processamento até receber a resposta do usuário.
        return new Promise((resolve) => {
            if (_getPendingInputCount() >= 12) {
                log(
                    'WARN',
                    `[hook-tools/request_user_input] ${_getPendingInputCount()} inputs estruturados pendentes; mantendo fila viva e auditável.`,
                );
            }

            const requestId = _nextInputId();
            _registerPendingInput(requestId, (answer) => {
                clearTimeout(autoCleanupTimer);
                resolve({
                    requestId,
                    question: fullQuestion,
                    choices: choices ?? [],
                    allowFreeform,
                    status: 'resolved',
                    answer,
                    instruction: 'Resposta recebida. Processar e continuar o fluxo.',
                });
            }, {
                question: fullQuestion,
                choices: choices ?? [],
                allowFreeform,
                createdAt: Date.now(),
                data: { source: 'request_user_input', requires_selection: requires_selection === true },
            });
            // BUG-P2-06: auto-cleanup após 10min para evitar memory leak se resolver nunca é chamado
            const autoCleanupTimer = setTimeout(() => {
                if (_deletePendingInput(requestId)) {
                    resolve({
                        requestId,
                        question: fullQuestion,
                        choices: choices ?? [],
                        allowFreeform,
                        status: 'timeout',
                        answer: '',
                        instruction: 'Timeout: usuário não respondeu em 10 minutos. Continuar sem resposta.',
                    });
                }
            }, 600_000);
            autoCleanupTimer.unref();
            // ARCH-03 (fix): broadcastSse injetado via configureHookTools() — sem import dinâmico circular
            const payload = normalizeUserInputBridgeContract({
                requestId,
                question: fullQuestion,
                choices: choices ?? [],
                allowFreeform,
            });
            _broadcast('waiting_for_input', payload);
        });
    },
});

// ─── Tool: hook_get_pending_tasks_summary ─────────────────────────────────────

/**
 * Tool: hook_get_pending_tasks_summary
 *
 * Lê `pending-tasks.md` e retorna um resumo estruturado das tarefas pendentes.
 */
const hookGetPendingTasksTool = buildTool({
    name: 'hook_get_pending_tasks',
    description:
        'Lista as tarefas pendentes do hook system (pending-tasks.md). ' +
        'Use para verificar o backlog atual antes de solicitar input ao usuário.',
    parameters: z.object({}),
    handler: async () => {
        const pendingPath = join(HOOK_STATE_DIR, 'pending-tasks.md');
        let pendingExists = false;
        try {
            await access(pendingPath);
            pendingExists = true;
        } catch {
            // file does not exist
        }
        if (!pendingExists) {
            return { content: '', exists: false };
        }
        try {
            const content = (await readText(pendingPath)).content;
            log('INFO', `[hook-tools/get_pending_tasks] pending-tasks.md lido (${content.length} chars).`);
            return { content, exists: true };
        } catch (e) {
            log('WARN', `[hook-tools/get_pending_tasks] Erro: ${toError(e).message}`);
            return { content: '', exists: false, error: toError(e).message };
        }
    },
});

// ─── Exportações ──────────────────────────────────────────────────────────────

/**
 * Array de Custom Tools do hook system prontas para uso no SDK.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const hookTools = [withSkipPermission(hookGetAuditTailTool), requestUserInputTool, hookGetPendingTasksTool];

export { hookGetAuditTailTool, hookGetPendingTasksTool, requestUserInputTool };
