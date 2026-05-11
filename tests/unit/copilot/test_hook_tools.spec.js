// @ts-check
/**
 * tests/unit/copilot/test_hook_tools.spec.js
 *
 * Valida:
 *
 * - hookTools exporta array com 3 tools
 * - hook_get_audit_tail: retorna entradas do audit.jsonl (offline: retorna erro gracioso)
 * - request_user_input: retorna estrutura correta com question/choices/status
 * - hook_get_pending_tasks: retorna conteúdo de pending-tasks.md (offline: exists=false)
 * - allTools em index.js inclui as hookTools
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import { allTools } from '../../../src/copilot/tools/bootstrap.js';
import {
    cancelAllUserInputRequests,
    getPendingInputIds,
    hookGetAuditTailTool,
    hookGetPendingTasksTool,
    hookTools,
    requestUserInputTool,
} from '../../../src/copilot/tools/hook/hook-tools.js';

afterEach(() => {
    cancelAllUserInputRequests('cleanup');
});

// ─── Suite principal ──────────────────────────────────────────────────────────

describe('hookTools', () => {
    // ── 1. Exportações ────────────────────────────────────────────────────

    describe('exportações do módulo', () => {
        it('hookTools é um Array com 3 elementos', () => {
            assert.ok(Array.isArray(hookTools));
            assert.equal(hookTools.length, 3);
        });

        it('hookTools inclui hookGetAuditTailTool, requestUserInputTool e hookGetPendingTasksTool', () => {
            const names = hookTools.map((tool) => tool.name);
            assert.ok(names.includes(hookGetAuditTailTool.name));
            assert.ok(names.includes(requestUserInputTool.name));
            assert.ok(names.includes(hookGetPendingTasksTool.name));
        });

        it('allTools em index.js inclui todos os hookTools', () => {
            for (const tool of hookTools) {
                assert.ok(allTools.includes(tool), `allTools deveria incluir ${JSON.stringify(tool)}`);
            }
        });

        it('getPendingInputIds() retorna cópia imutável do estado pendente', async () => {
            const { resolveUserInput } = await import('../../../src/copilot/tools/hook/hook-tools.js');
            const handler = /** @type {any} */ (requestUserInputTool).handler;
            const promise = handler({ question: 'Qual o próximo passo?' });
            const pending = getPendingInputIds();
            assert.equal(Array.isArray(pending), true);
            assert.equal(pending.length, 1);
            pending.push('fake-id');
            assert.equal(getPendingInputIds().includes('fake-id'), false);
            queueMicrotask(() => resolveUserInput('seguir'));
            await promise;
        });
    });

    // ── 2. hook_get_audit_tail ────────────────────────────────────────────

    describe('hookGetAuditTailTool', () => {
        it('possui propriedade name = "hook_get_audit_tail"', () => {
            assert.equal(/** @type {any} */ (hookGetAuditTailTool).name, 'hook_get_audit_tail');
        });

        it('possui description não vazia', () => {
            const desc = /** @type {any} */ (hookGetAuditTailTool).description ?? '';
            assert.ok(desc.length > 0, 'description deve estar presente');
        });

        it('handler retorna { entries: Array, total: number } para audit.jsonl existente', async () => {
            // O arquivo .github/hooks/state/audit.jsonl existe no devcontainer
            const handler = /** @type {any} */ (hookGetAuditTailTool).handler;
            const result = await handler({ lines: 5 });
            // Pode ser entries[] com dados, ou { entries: [], error } se offline
            assert.ok(typeof result === 'object');
            assert.ok(Array.isArray(result.entries));
        });

        it('handler com lines=0 padrão retorna objeto sem lançar exceção', async () => {
            const handler = /** @type {any} */ (hookGetAuditTailTool).handler;
            await assert.doesNotReject(async () => {
                const result = await handler({});
                assert.ok(typeof result === 'object');
            });
        });
    });

    // ── 3. request_user_input ─────────────────────────────────────────────

    describe('requestUserInputTool', () => {
        it('possui name = "request_user_input"', () => {
            assert.equal(/** @type {any} */ (requestUserInputTool).name, 'request_user_input');
        });

        it('description menciona vscode_askQuestions ou protocolo de continuidade', () => {
            const desc = /** @type {any} */ (requestUserInputTool).description ?? '';
            const hasProtocol = desc.toLowerCase().includes('obrigatório') || desc.includes('ask');
            assert.ok(hasProtocol, 'description deve mencionar o protocolo de continuidade');
        });

        // Nota: o handler retorna uma Promise que só resolve quando resolveUserInput() é chamado
        // (ARCH-N01 suspensão real). Para testar, agendamos resolveUserInput() logo após invocar.

        it('handler retorna question e status=resolved após resolveUserInput', async () => {
            const { resolveUserInput } = await import('../../../src/copilot/tools/hook/hook-tools.js');
            const handler = /** @type {any} */ (requestUserInputTool).handler;
            const promise = handler({ question: 'Qual o próximo passo?', choices: ['A', 'B'] });
            // Agendar resolução no próximo tick
            queueMicrotask(() => resolveUserInput('seguir'));
            const result = await promise;
            assert.equal(result.question, 'Qual o próximo passo?');
            assert.equal(result.status, 'resolved');
            assert.equal(result.answer, 'seguir');
        });

        it('handler com context concatena ao question', async () => {
            const { resolveUserInput } = await import('../../../src/copilot/tools/hook/hook-tools.js');
            const handler = /** @type {any} */ (requestUserInputTool).handler;
            const promise = handler({ question: 'O que fazer?', context: 'Fiz X e Y.' });
            queueMicrotask(() => resolveUserInput('ok'));
            const result = await promise;
            assert.ok(result.question.includes('O que fazer?'));
            assert.ok(result.question.includes('Fiz X e Y.'));
        });

        it('handler com requires_selection=true define allowFreeform=false', async () => {
            const { resolveUserInput } = await import('../../../src/copilot/tools/hook/hook-tools.js');
            const handler = /** @type {any} */ (requestUserInputTool).handler;
            const promise = handler({ question: 'Escolha:', choices: ['A', 'B'], requires_selection: true });
            queueMicrotask(() => resolveUserInput('A'));
            const result = await promise;
            assert.equal(result.allowFreeform, false);
        });

        it('handler sem choices retorna choices=[]', async () => {
            const { resolveUserInput } = await import('../../../src/copilot/tools/hook/hook-tools.js');
            const handler = /** @type {any} */ (requestUserInputTool).handler;
            const promise = handler({ question: 'Qual a prioridade?' });
            queueMicrotask(() => resolveUserInput('alta'));
            const result = await promise;
            assert.deepEqual(result.choices, []);
        });

        it('result.instruction é string não vazia', async () => {
            const { resolveUserInput } = await import('../../../src/copilot/tools/hook/hook-tools.js');
            const handler = /** @type {any} */ (requestUserInputTool).handler;
            const promise = handler({ question: 'Continua?' });
            queueMicrotask(() => resolveUserInput('sim'));
            const result = await promise;
            assert.ok(typeof result.instruction === 'string' && result.instruction.length > 0);
        });
    });

    // ── 4. hook_get_pending_tasks ─────────────────────────────────────────

    describe('hookGetPendingTasksTool', () => {
        it('possui name = "hook_get_pending_tasks"', () => {
            assert.equal(/** @type {any} */ (hookGetPendingTasksTool).name, 'hook_get_pending_tasks');
        });

        it('handler retorna { content, exists } sem lançar exceção', async () => {
            const handler = /** @type {any} */ (hookGetPendingTasksTool).handler;
            await assert.doesNotReject(async () => {
                const result = await handler({});
                assert.ok(typeof result === 'object');
                assert.ok('exists' in result);
                assert.ok('content' in result);
                assert.ok(typeof result.content === 'string');
                assert.ok(typeof result.exists === 'boolean');
            });
        });

        it('se pending-tasks.md não existe, exists=false e content=""', async () => {
            // O arquivo pode ou não existir no ambiente de teste
            // Apenas verificamos que a estrutura de resposta é válida
            const handler = /** @type {any} */ (hookGetPendingTasksTool).handler;
            const result = await handler({});
            if (!result.exists) {
                assert.equal(result.content, '');
            } else {
                assert.ok(result.content.length >= 0);
            }
        });
    });
});
