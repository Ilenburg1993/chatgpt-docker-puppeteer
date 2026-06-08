/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test file usa mocks não tipados
/**
 * Testes — isExpectedResumeMiss (sdk/session/lifecycle.js)
 *
 * Valida que a função classifica corretamente os padrões de "resume miss esperado"
 * após expansão dos padrões suportados (HTTP 404/410 + variações SDK).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks obrigatórios antes do import do módulo ────────────────────────

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('../../../../src/copilot/sdk/logger.js', () => ({
    log: vi.fn(),
    setSdkLogger: vi.fn(),
}));

vi.mock('@github/copilot-sdk', () => ({
    CopilotClient: vi.fn(),
    approveAll: vi.fn(),
    defineTool: vi.fn(),
    SYSTEM_MESSAGE_SECTIONS: {
        guidelines: { name: 'guidelines' },
        identity: { name: 'identity' },
        context: { name: 'context' },
        safety: { name: 'safety' },
        responseFormat: { name: 'responseFormat' },
        tools: { name: 'tools' },
        abilities: { name: 'abilities' },
        instructions: { name: 'instructions' },
        conversationRules: { name: 'conversationRules' },
        errorHandling: { name: 'errorHandling' },
    },
    SYSTEM_PROMPT_SECTIONS: {
        guidelines: { name: 'guidelines' },
        identity: { name: 'identity' },
        context: { name: 'context' },
        safety: { name: 'safety' },
        responseFormat: { name: 'responseFormat' },
        tools: { name: 'tools' },
        abilities: { name: 'abilities' },
        instructions: { name: 'instructions' },
        conversationRules: { name: 'conversationRules' },
        errorHandling: { name: 'errorHandling' },
    },
}));

vi.mock('../../../../src/copilot/sdk/telemetry/operation-metrics.js', () => ({
    emitSdkOperationMetric: vi.fn(),
    setSdkMetricEmitter: vi.fn(),
}));

import { __test__ } from '../../../../src/copilot/sdk/session/lifecycle.js';

const { isExpectedResumeMiss } = __test__;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * @param {string} message
 * @param {number} [status]
 */
function makeError(message, status) {
    const err = new Error(message);
    if (status !== undefined) {
        /** @type {any} */ (err).status = status;
    }
    return err;
}

// ─── Testes ──────────────────────────────────────────────────────────────

describe('isExpectedResumeMiss', () => {
    describe('operação não-resume → sempre false', () => {
        it('retorna false para session.create mesmo com mensagem de miss', () => {
            expect(isExpectedResumeMiss('session.create', makeError('session not found'))).toBe(false);
        });
    });

    describe('padrões clássicos (originais)', () => {
        it('reconhece "session not found" (inglês)', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('session not found'))).toBe(true);
        });

        it('reconhece "sessao nao encontrada" (português sem acento)', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('sessao nao encontrada'))).toBe(true);
        });

        it('reconhece "sessão não encontrada" (português com acento)', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('sessão não encontrada'))).toBe(true);
        });
    });

    describe('padrões de expiração e invalidação (novos)', () => {
        it('reconhece "session expired"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('session expired'))).toBe(true);
        });

        it('reconhece "session invalid"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('session invalid'))).toBe(true);
        });

        it('reconhece "invalid session"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('invalid session id: abc123'))).toBe(true);
        });

        it('reconhece "unknown session"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('unknown session'))).toBe(true);
        });

        it('reconhece "session does not exist"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('session does not exist'))).toBe(true);
        });

        it('reconhece "no session with id"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('no session with id abc-123'))).toBe(true);
        });

        it('reconhece "no such session"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('no such session'))).toBe(true);
        });

        it('reconhece "session is not active"', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('session is not active'))).toBe(true);
        });
    });

    describe('HTTP status codes (novos)', () => {
        it('reconhece HTTP 404 como miss esperado', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('Not Found', 404))).toBe(true);
        });

        it('reconhece HTTP 410 (Gone) como miss esperado', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('Gone', 410))).toBe(true);
        });

        it('NÃO classifica HTTP 500 como miss esperado', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('Internal Server Error', 500))).toBe(false);
        });

        it('NÃO classifica HTTP 401 como miss esperado', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('Unauthorized', 401))).toBe(false);
        });
    });

    describe('mensagens não-relacionadas → false', () => {
        it('retorna false para erro de rede genérico', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('ECONNREFUSED localhost:3008'))).toBe(false);
        });

        it('retorna false para timeout', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('operation timed out after 30000ms'))).toBe(false);
        });

        it('retorna false para erro de parsing', () => {
            expect(isExpectedResumeMiss('session.resume', makeError('unexpected token in JSON'))).toBe(false);
        });
    });

    describe('entradas não-error', () => {
        it('aceita string como erro', () => {
            expect(isExpectedResumeMiss('session.resume', 'session not found')).toBe(true);
        });

        it('aceita objeto com message como erro', () => {
            expect(isExpectedResumeMiss('session.resume', { message: 'session expired', status: 410 })).toBe(true);
        });

        it('retorna false para null', () => {
            expect(isExpectedResumeMiss('session.resume', null)).toBe(false);
        });
    });
});
