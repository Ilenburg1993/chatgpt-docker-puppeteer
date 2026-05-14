// @ts-check
/**
 * Testes da camada canônica de feedback de falha para tools.
 */

import { describe, expect, it } from 'vitest';
import {
    buildTool,
    classifyToolFailure,
    createToolFailureResponse,
    enrichToolFailureResult,
    withToolFailureFeedback,
} from '../../../../src/copilot/tools/index.js';

describe('tool failure feedback', () => {
    it('classifica parâmetros inválidos com orientação de correção', () => {
        const feedback = enrichToolFailureResult(
            { success: false, error: 'Caminho inválido: path vazio.' },
            {
                toolName: 'read_file_content',
                parameters: {
                    type: 'object',
                    required: ['path'],
                    properties: {
                        path: { type: 'string', description: 'Caminho absoluto do arquivo.' },
                    },
                },
                receivedParameters: { path: '' },
            },
        );

        expect(feedback).toMatchObject({
            success: false,
            error: 'Caminho inválido: path vazio.',
            toolFeedback: {
                version: 1,
                toolName: 'read_file_content',
                category: 'invalid-parameters',
                retryable: false,
            },
        });
        expect(/** @type {any} */ (feedback).toolFeedback.fix).toMatch(/Corrija os argumentos/);
        expect(/** @type {any} */ (feedback).toolFeedback.expectedParameters.required).toEqual(['path']);
        expect(/** @type {any} */ (feedback).toolFeedback.receivedParameters).toEqual({ path: '' });
    });

    it('preserva sucesso sem adicionar ruído ao resultado', async () => {
        const handler = withToolFailureFeedback('ok_tool', async () => ({ success: true, value: 42 }));

        const result = await handler({});

        expect(result).toEqual({ success: true, value: 42 });
    });

    it('transforma exceção em falha estruturada para a LLM', async () => {
        const error = new TypeError('Parâmetro mode deve ser enum válido.');
        /** @type {any} */ (error).code = 'ERR_INVALID_ARG_VALUE';
        const handler = withToolFailureFeedback('mode_set', async () => {
            throw error;
        });

        const result = await handler({ mode: 'root' });

        expect(result).toMatchObject({
            success: false,
            ok: false,
            error: 'Parâmetro mode deve ser enum válido.',
            toolFeedback: {
                toolName: 'mode_set',
                category: 'invalid-parameters',
                receivedParameters: { mode: 'root' },
            },
        });
    });

    it('propaga detalhes úteis de operação, cursor e execução sem despejar payloads grandes', () => {
        const feedback = enrichToolFailureResult(
            {
                success: false,
                error: 'expectedHash divergente',
                exitCode: 1,
                nextCursor: 'cursor-2',
                operation: {
                    operationId: 'op-1',
                    traceId: 'trace-1',
                    status: 'failed',
                    capability: 'file.write',
                },
                metadata: {
                    engine: 'rg',
                    truncated: true,
                    totalMatches: 100,
                },
                content: 'x'.repeat(400),
            },
            { toolName: 'patch_file', receivedParameters: { path: '/tmp/a.js' } },
        );

        expect(feedback).toMatchObject({
            toolFeedback: {
                category: 'conflict',
                details: {
                    exitCode: 1,
                    nextCursor: 'cursor-2',
                    operation: {
                        operationId: 'op-1',
                        traceId: 'trace-1',
                        status: 'failed',
                    },
                    metadata: {
                        engine: 'rg',
                        truncated: true,
                        totalMatches: 100,
                    },
                },
            },
        });
        expect(/** @type {any} */ (feedback).toolFeedback.details.content).toBeUndefined();
    });

    it('marca timeouts e falhas externas como retentáveis', () => {
        const timeout = new Error('process timed out');
        /** @type {any} */ (timeout).code = 'ETIMEDOUT';
        const network = new Error('fetch failed with HTTP 429 rate limit');

        expect(classifyToolFailure(timeout)).toBe('timeout');
        expect(createToolFailureResponse({ toolName: 'web_fetch', error: timeout }).toolFeedback.retryable).toBe(true);
        expect(classifyToolFailure(network)).toBe('external-service');
        expect(createToolFailureResponse({ toolName: 'web_search', error: network }).toolFeedback.retryable).toBe(true);
    });

    it('redige segredos e trunca valores recebidos no feedback', async () => {
        const handler = withToolFailureFeedback(
            'secret_tool',
            async () => ({ success: false, error: 'invalid token' }),
            { parameters: { type: 'object', properties: { token: { type: 'string' } } } },
        );

        const result = await handler({
            token: 'super-secret',
            content: 'x'.repeat(400),
        });

        expect(result).toMatchObject({
            success: false,
            toolFeedback: {
                category: 'invalid-parameters',
                receivedParameters: {
                    token: '[redacted]',
                },
            },
        });
        expect(/** @type {any} */ (result).toolFeedback.receivedParameters.content).toHaveLength(243);
    });

    it('buildTool aplica feedback em falhas legadas do handler', async () => {
        const tool = buildTool({
            name: 'demo_failure_feedback',
            description: 'Tool de teste de feedback',
            parameters: {
                type: 'object',
                required: ['path'],
                properties: {
                    path: { type: 'string' },
                },
            },
            handler: async () => ({ success: false, error: 'Arquivo não encontrado.' }),
        });

        const result = await tool.handler({ path: '/tmp/missing' });

        expect(result).toMatchObject({
            success: false,
            error: 'Arquivo não encontrado.',
            toolFeedback: {
                toolName: 'demo_failure_feedback',
                category: 'not-found',
                expectedParameters: {
                    required: ['path'],
                    propertyCount: 1,
                },
            },
        });
    });
});
