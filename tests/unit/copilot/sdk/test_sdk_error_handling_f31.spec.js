// @ts-check
import { describe, it } from 'node:test';
/**
 * @file Faixa 31 — Error Handling Consolidation
 *
 *   Verifica os contratos do sistema de tratamento de erros do módulo copilot:
 *
 *   - F153: hierarquia de erros (CopilotError, SessionError, BridgeError, etc.)
 *   - F154: isFatalError classifica erros corretamente
 *   - F155: isTransientError identifica erros retriáveis
 *   - F156: logSwallowed e wrapAsync funcionam (não relançam)
 *   - F157: error-codes exporta todas as constantes esperadas
 *   - F158: erros preservam name e code (identidade tipada)
 */

import * as ERROR_CODES from '#copilot/core/error-codes';
import { isFatalError, isTransientError, logSwallowed, wrapAsync } from '#copilot/core/error-handlers';
import {
    BridgeError,
    ConfigError,
    CopilotError,
    SessionError,
    StateTransitionError,
    TimeoutError,
    ToolError,
    ValidationError,
} from '#copilot/core/errors';
import { describe, expect, it } from 'vitest';

// ─── F153: hierarquia de erros ─────────────────────────────────────────────

describe('F153 — hierarquia de erros', () => {
    it('CopilotError tem name correto', () => {
        const e = new CopilotError('msg');
        expect(e.name).toBe('CopilotError');
        expect(e.code).toBe('COPILOT_ERROR');
        expect(e).toBeInstanceOf(Error);
    });

    it('CopilotError aceita code customizado', () => {
        const e = new CopilotError('msg', 'CUSTOM_CODE');
        expect(e.code).toBe('CUSTOM_CODE');
    });

    it('SessionError extends CopilotError', () => {
        const e = new SessionError('session fail');
        expect(e).toBeInstanceOf(CopilotError);
        expect(e.name).toBe('SessionError');
        expect(e.code).toBe('SESSION_ERROR');
    });

    it('BridgeError extends CopilotError', () => {
        const e = new BridgeError('bridge fail');
        expect(e).toBeInstanceOf(CopilotError);
        expect(e.name).toBe('BridgeError');
        expect(e.code).toBe('BRIDGE_ERROR');
    });

    it('ConfigError extends CopilotError', () => {
        const e = new ConfigError('config fail');
        expect(e).toBeInstanceOf(CopilotError);
        expect(e.name).toBe('ConfigError');
    });

    it('ToolError extends CopilotError', () => {
        const e = new ToolError('tool fail');
        expect(e).toBeInstanceOf(CopilotError);
        expect(e.name).toBe('ToolError');
    });

    it('TimeoutError extends CopilotError', () => {
        const e = new TimeoutError('timeout');
        expect(e).toBeInstanceOf(CopilotError);
        expect(e.name).toBe('TimeoutError');
        expect(e.code).toBe('TIMEOUT');
    });

    it('ValidationError extends CopilotError', () => {
        const e = new ValidationError('invalid');
        expect(e).toBeInstanceOf(CopilotError);
        expect(e.name).toBe('ValidationError');
    });

    it('StateTransitionError extends CopilotError', () => {
        const e = new StateTransitionError('bad transition');
        expect(e).toBeInstanceOf(CopilotError);
        expect(e.name).toBe('StateTransitionError');
    });

    it('erros preservam a message', () => {
        const msg = 'mensagem específica de erro';
        const e = new SessionError(msg);
        expect(e.message).toBe(msg);
    });
});

// ─── F154: isFatalError ────────────────────────────────────────────────────

describe('F154 — isFatalError classifica corretamente', () => {
    it('retorna false para erros comuns', () => {
        expect(isFatalError(new Error('common error'))).toBe(false);
    });

    it('retorna false para SessionError com code padrão', () => {
        expect(isFatalError(new SessionError('session issue'))).toBe(false);
    });

    it('retorna false para BridgeError (BridgeError é transiente, não fatal)', () => {
        expect(isFatalError(new BridgeError('bridge issue'))).toBe(false);
    });

    it('retorna true para CopilotError com code SESSION_FATAL', () => {
        const e = new CopilotError('fatal', 'SESSION_FATAL');
        expect(isFatalError(e)).toBe(true);
    });

    it('retorna true para Error com code ERR_SOCKET_CLOSED', () => {
        const e = Object.assign(new Error('socket closed'), { code: 'ERR_SOCKET_CLOSED' });
        expect(isFatalError(e)).toBe(true);
    });

    it('retorna true para Error com code ERR_IPC_CHANNEL_CLOSED', () => {
        const e = Object.assign(new Error('ipc closed'), { code: 'ERR_IPC_CHANNEL_CLOSED' });
        expect(isFatalError(e)).toBe(true);
    });

    it('retorna false para non-Error (null, string, number)', () => {
        expect(isFatalError(null)).toBe(false);
        expect(isFatalError('error string')).toBe(false);
        expect(isFatalError(42)).toBe(false);
    });
});

// ─── F155: isTransientError ────────────────────────────────────────────────

describe('F155 — isTransientError identifica erros retriáveis', () => {
    it('retorna true para BridgeError', () => {
        expect(isTransientError(new BridgeError('connection failed'))).toBe(true);
    });

    it('retorna true para Error com code ECONNREFUSED', () => {
        const e = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
        expect(isTransientError(e)).toBe(true);
    });

    it('retorna true para Error com code ETIMEDOUT', () => {
        const e = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        expect(isTransientError(e)).toBe(true);
    });

    it('retorna true para Error HTTP 429', () => {
        const e = Object.assign(new Error('rate limited'), { status: 429 });
        expect(isTransientError(e)).toBe(true);
    });

    it('retorna true para Error HTTP 503', () => {
        const e = Object.assign(new Error('service unavailable'), { statusCode: 503 });
        expect(isTransientError(e)).toBe(true);
    });

    it('retorna false para erros comuns (não retriáveis)', () => {
        expect(isTransientError(new Error('generic error'))).toBe(false);
    });

    it('retorna false para ValidationError', () => {
        expect(isTransientError(new ValidationError('invalid input'))).toBe(false);
    });

    it('retorna false para non-Error', () => {
        expect(isTransientError(null)).toBe(false);
        expect(isTransientError(undefined)).toBe(false);
    });
});

// ─── F156: logSwallowed e wrapAsync ────────────────────────────────────────

describe('F156 — logSwallowed não relança e wrapAsync retorna undefined em erro', () => {
    it('logSwallowed não lança exceção para Error', () => {
        expect(() => logSwallowed(new Error('test'), 'test.ctx')).not.toThrow();
    });

    it('logSwallowed não lança exceção para string', () => {
        expect(() => logSwallowed('string error', 'test.ctx')).not.toThrow();
    });

    it('logSwallowed não lança exceção para null', () => {
        expect(() => logSwallowed(null, 'test.ctx')).not.toThrow();
    });

    it('wrapAsync resolve normalmente quando fn não lança', async () => {
        const result = await wrapAsync(async () => 42, 'test.ctx');
        expect(result).toBe(42);
    });

    it('wrapAsync retorna undefined quando fn lança erro', async () => {
        const result = await wrapAsync(async () => {
            throw new Error('boom');
        }, 'test.ctx');
        expect(result).toBeUndefined();
    });

    it('wrapAsync não propaga o erro', async () => {
        await expect(
            wrapAsync(async () => {
                throw new Error('boom');
            }, 'test.ctx'),
        ).resolves.toBeUndefined();
    });
});

// ─── F157: error-codes exporta constantes ──────────────────────────────────

describe('F157 — error-codes exporta todas as constantes esperadas', () => {
    const EXPECTED_CODES = [
        'COPILOT_ERROR',
        'SESSION_ERROR',
        'CONFIG_ERROR',
        'TOOL_ERROR',
        'BRIDGE_ERROR',
        'TIMEOUT',
        'DIALOG_TIMEOUT',
        'VALIDATION_ERROR',
        'STATE_TRANSITION',
        'DIALOG_NOT_ACTIVE',
        'DIALOG_QUEUE_FULL',
        'LLM_B_BUSY',
        'LLM_B_UNAVAILABLE',
        'PAYLOAD_TOO_LARGE',
    ];

    for (const code of EXPECTED_CODES) {
        it(`exporta constante ${code}`, () => {
            expect(ERROR_CODES).toHaveProperty(code);
            expect(typeof ERROR_CODES[/** @type {keyof typeof ERROR_CODES} */ (code)]).toBe('string');
        });
    }
});

// ─── F158: erros preservam identidade tipada ───────────────────────────────

describe('F158 — erros preservam identidade tipada (instanceof chain)', () => {
    it('SessionError instanceof CopilotError e Error', () => {
        const e = new SessionError('test');
        expect(e).toBeInstanceOf(SessionError);
        expect(e).toBeInstanceOf(CopilotError);
        expect(e).toBeInstanceOf(Error);
    });

    it('BridgeError instanceof CopilotError e Error', () => {
        const e = new BridgeError('test');
        expect(e).toBeInstanceOf(BridgeError);
        expect(e).toBeInstanceOf(CopilotError);
        expect(e).toBeInstanceOf(Error);
    });

    it('erro desconhecido NÃO instanceof CopilotError', () => {
        expect(new Error('plain')).not.toBeInstanceOf(CopilotError);
    });

    it('string NÃO instanceof qualquer erro', () => {
        expect('error string').not.toBeInstanceOf(Error);
        expect('error string').not.toBeInstanceOf(CopilotError);
    });
});
