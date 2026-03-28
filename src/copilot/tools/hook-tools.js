// @ts-check
/**
 * src/copilot/tools/hook-tools.js
 *
 * Custom Tools que expõem o hook system do projeto ao Always-Alive Agent (LLM-B).
 *
 * Responsabilidades:
 *
 * - `hook_get_audit_tail` — lê as últimas N linhas do audit.jsonl para diagnóstico
 * - `request_user_input` — implementa o padrão "vscode_askQuestions" para LLM-B: força o modelo a sempre perguntar ao
 *   usuário qual é o próximo passo, garantindo o loop de interação contínua análogo ao protocolo de hooks.
 *
 * **ARQUITETURA DO `request_user_input`**: O SDK Copilot inclui nativamente a tool `ask_user` que chama
 * `onUserInputRequest`. Esta tool `request_user_input` é um wrapper semântico mais rico — com campo `choices` tipado e
 * `context` para o usuário entender o estado atual. Quando o agente LLM-B a invoca, o retorno é o input recebido via
 * `POST /api/copilot/answer` (ou equivalente na interface ativa).
 *
 * @module copilot/tools/hook-tools
 */

import { log } from '#core/logger';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { buildTool, withSkipPermission } from './tool-factory.js';
const execFileAsync = promisify(execFile);

/**
 * Raiz do repositório — calculada em relação a este arquivo (src/copilot/tools/).
 *
 * @type {string}
 */
const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');

/**
 * Diretório de estado do hook system.
 *
 * @type {string}
 */
const HOOK_STATE_DIR = join(ROOT, '.github', 'hooks', 'state');

/**
 * ARCH-N01 (fix): Resolver pendente para suspensão real do SDK via request_user_input. Quando o handler cria a Promise
 * de suspensão, registra aqui o resolver. O agente chama resolveUserInput() via answerPendingQuestion() para
 * desbloquear o modelo.
 *
 * @type {((answer: string) => void) | null}
 */
let _pendingInputResolver = null;

/**
 * ARCH-N01: Registra uma resposta para a tool request_user_input pendente. Deve ser chamado pelo agente quando receber
 * POST /api/copilot/answer.
 *
 * @param {string} answer
 * @returns {boolean} true se havia uma Promise pendente, false se não
 */
export function resolveUserInput(answer) {
    if (!_pendingInputResolver) return false;
    const fn = _pendingInputResolver;
    _pendingInputResolver = null;
    fn(answer);
    return true;
}

// ─── Tool: hook_get_audit_tail ────────────────────────────────────────────────

/**
 * Tool: hook_get_audit_tail
 *
 * Lê as últimas N entradas do audit.jsonl do hook system. Útil para diagnosticar compliance e histórico de chamadas de
 * ferramentas.
 */
const hookGetAuditTailTool = buildTool({
    name: 'hook_get_audit_tail',
    description:
        'Lê as últimas entradas do audit.jsonl do hook system. Útil para verificar compliance, ' +
        'histórico de chamadas de ferramentas e detectar violações de protocolo.',
    parameters: z.object({
        lines: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .default(20)
            .describe('Número de linhas a retornar (padrão: 20, máximo: 200)'),
    }),
    handler: async (/** @type {{ lines?: number }} */ { lines }) => {
        const auditPath = join(HOOK_STATE_DIR, 'audit.jsonl');
        if (!existsSync(auditPath)) {
            log('WARN', '[hook-tools/get_audit_tail] audit.jsonl não encontrado.');
            return { entries: [], error: 'audit.jsonl não encontrado' };
        }
        try {
            const { stdout: raw } = await execFileAsync('tail', ['-n', String(lines ?? 20), auditPath], {
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
            log('INFO', `[hook-tools/get_audit_tail] Retornando ${entries.length} entradas do audit.`);
            return { entries, total: entries.length };
        } catch (/** @type {any} */ e) {
            log('WARN', `[hook-tools/get_audit_tail] Erro: ${e.message}`);
            return { entries: [], error: e.message };
        }
    },
});

// ─── Tool: request_user_input ─────────────────────────────────────────────────

/**
 * Tool: request_user_input
 *
 * Implementa o padrão "vscode_askQuestions" para LLM-B.
 *
 * INSTRUÇÕES AO MODELO (parte obrigatória do system prompt): "Ao final de qualquer resposta, SEMPRE use
 * request_user_input para perguntar ao usuário qual é o próximo passo. Nunca encerre sem chamar esta ferramenta."
 *
 * Quando invocada, o SDK suspende a execução via onUserInputRequest até que o usuário responda via POST
 * /api/copilot/answer (ou interface equivalente).
 */
const requestUserInputTool = buildTool({
    name: 'request_user_input',
    description:
        'Solicita input interativo ao usuário. ' +
        'OBRIGATÓRIO: use SEMPRE ao final de cada resposta para perguntar qual é o próximo passo. ' +
        'Nunca encerre uma resposta sem chamar esta ferramenta — ela garante a continuidade da sessão. ' +
        'É o equivalente ao vscode_askQuestions do protocolo de hooks: o agente não avança sem resposta.',
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
        const fullQuestion = context ? `${question}\n\n**Contexto**: ${context}` : question;
        const allowFreeform = !requires_selection;

        log('INFO', `[hook-tools/request_user_input] Pergunta: "${fullQuestion.slice(0, 100)}"`);

        // ARCH-N01 (fix): suspensão real — a Promise só resolve quando resolveUserInput() for chamado,
        // o que ocorre via answerPendingQuestion() no agente (POST /api/copilot/answer).
        // Isso garante que o modelo não continua processamento até receber a resposta do usuário.
        return new Promise((resolve) => {
            _pendingInputResolver = (answer) => {
                resolve({
                    question: fullQuestion,
                    choices: choices ?? [],
                    allowFreeform,
                    status: 'resolved',
                    answer,
                    instruction: 'Resposta recebida. Processar e continuar o fluxo.',
                });
            };
            // Emite evento SSE para que a interface saiba que o agente está aguardando input
            // (broadcastSse importado dinamicamente para evitar dependência cíclica)
            import('../terminal/dialog.js')
                .then(({ broadcastSse }) => {
                    broadcastSse('waiting_for_input', {
                        question: fullQuestion,
                        choices: choices ?? [],
                        allowFreeform,
                    });
                })
                .catch(() => {});
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
        if (!existsSync(pendingPath)) {
            return { content: '', exists: false };
        }
        try {
            const content = readFileSync(pendingPath, 'utf8');
            log('INFO', `[hook-tools/get_pending_tasks] pending-tasks.md lido (${content.length} chars).`);
            return { content, exists: true };
        } catch (/** @type {any} */ e) {
            log('WARN', `[hook-tools/get_pending_tasks] Erro: ${e.message}`);
            return { content: '', exists: false, error: e.message };
        }
    },
});

// ─── Exportações ──────────────────────────────────────────────────────────────

/**
 * Array de Custom Tools do hook system prontas para uso no SDK.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const hookTools = [withSkipPermission(hookGetAuditTailTool), requestUserInputTool, hookGetPendingTasksTool];

export { hookGetAuditTailTool, hookGetPendingTasksTool, requestUserInputTool };
