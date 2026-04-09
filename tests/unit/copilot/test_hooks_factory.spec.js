// @ts-check
/**
 * tests/unit/copilot/test_hooks_factory.spec.js
 *
 * Testes unitários para src/copilot/hooks/factory.js (402L).
 *
 * Valida:
 *
 * - createHooks: retorna SessionHooks com handlers padrão
 * - buildPreToolUseHandler: allow/deny/denyPatterns/askHandler/argsModifier
 * - buildErrorOccurredHandler: retry/skip/abort por contexto
 * - createMinimalHooks / createAuditHooks / createDenyAllHooks / createSafeHooks presets
 * - composePreToolUseHandlers: cadeia com short-circuit
 * - createErrorNotifierHook: delegação ao callback
 */

import { describe, expect, it, vi } from 'vitest';
import {
    composePreToolUseHandlers,
    createAuditHooks,
    createDenyAllHooks,
    createErrorNotifierHook,
    createHooks,
    createMinimalHooks,
    createSafeHooks,
} from '../../../src/copilot/hooks/factory.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** @param {string} toolName */
const makeInput = (toolName, args = {}) => ({ toolName, toolArgs: args });

/** @param {string} [sessionId] */
const makeInvocation = (sessionId = 'sess-1') => ({ sessionId });

// ─── createHooks ──────────────────────────────────────────────────────────────

describe('hooks/factory › createHooks', () => {
    it('retorna objeto com onPreToolUse e onErrorOccurred por padrão', () => {
        const hooks = createHooks();
        expect(hooks.onPreToolUse).toBeTypeOf('function');
        expect(hooks.onErrorOccurred).toBeTypeOf('function');
    });

    it('sem auditLog, não cria onPostToolUse/onSessionStart/onSessionEnd', () => {
        const hooks = createHooks();
        expect(hooks.onPostToolUse).toBeUndefined();
        expect(hooks.onSessionStart).toBeUndefined();
        expect(hooks.onSessionEnd).toBeUndefined();
        expect(hooks.onUserPromptSubmitted).toBeUndefined();
    });

    it('com auditLog=true, cria todos os 6 handlers', () => {
        const hooks = createHooks({ auditLog: true });
        expect(hooks.onPreToolUse).toBeTypeOf('function');
        expect(hooks.onPostToolUse).toBeTypeOf('function');
        expect(hooks.onUserPromptSubmitted).toBeTypeOf('function');
        expect(hooks.onSessionStart).toBeTypeOf('function');
        expect(hooks.onSessionEnd).toBeTypeOf('function');
        expect(hooks.onErrorOccurred).toBeTypeOf('function');
    });

    it('usa handler customizado quando fornecido em cfg', () => {
        const custom = vi.fn();
        const hooks = createHooks({ onPreToolUse: custom });
        expect(hooks.onPreToolUse).toBe(custom);
    });
});

// ─── PreToolUse: allow/deny logic ────────────────────────────────────────────

describe('hooks/factory › onPreToolUse', () => {
    it('permite tool por padrão (sem restrições)', async () => {
        const hooks = createHooks();
        const result = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(result.permissionDecision).toBe('allow');
    });

    it('nega tool explicitamente listada em denyTools', async () => {
        const hooks = createHooks({ denyTools: ['rm_rf'] });
        const result = await hooks.onPreToolUse(makeInput('rm_rf'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
    });

    it('nega tool por denyPatterns regex', async () => {
        const hooks = createHooks({ denyPatterns: [/^shell_/] });
        const result = await hooks.onPreToolUse(makeInput('shell_exec'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
    });

    it('permite tool que não bate com denyPatterns', async () => {
        const hooks = createHooks({ denyPatterns: [/^shell_/] });
        const result = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(result.permissionDecision).toBe('allow');
    });

    it('denyPatterns com regex global /g não falha em chamadas consecutivas', async () => {
        const globalRegex = /^shell_/g; // bug: stateful regex
        const hooks = createHooks({ denyPatterns: [globalRegex] });
        // Chamadas consecutivas devem negar consistentemente (lastIndex reset)
        const r1 = await hooks.onPreToolUse(makeInput('shell_exec'), makeInvocation());
        const r2 = await hooks.onPreToolUse(makeInput('shell_exec'), makeInvocation());
        const r3 = await hooks.onPreToolUse(makeInput('shell_exec'), makeInvocation());
        expect(r1.permissionDecision).toBe('deny');
        expect(r2.permissionDecision).toBe('deny');
        expect(r3.permissionDecision).toBe('deny');
    });

    it('com allowTools, nega tool não listada', async () => {
        const hooks = createHooks({ allowTools: ['read_file', 'list_dir'] });
        const result = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
    });

    it('com allowTools, permite tool listada', async () => {
        const hooks = createHooks({ allowTools: ['read_file', 'list_dir'] });
        const result = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(result.permissionDecision).toBe('allow');
    });

    it('denyTools tem precedência sobre allowTools', async () => {
        const hooks = createHooks({ allowTools: ['bash', 'read_file'], denyTools: ['bash'] });
        const result = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
    });

    it('askHandler aprova tool não-listada em allow nem deny', async () => {
        const ask = vi.fn().mockResolvedValue(true);
        const hooks = createHooks({ allowTools: ['read_file'], onPermissionAsk: ask });
        const result = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(ask).toHaveBeenCalledWith('bash');
        expect(result.permissionDecision).toBe('allow');
    });

    it('askHandler nega tool quando retorna false', async () => {
        const ask = vi.fn().mockResolvedValue(false);
        const hooks = createHooks({ allowTools: ['read_file'], onPermissionAsk: ask });
        const result = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
    });

    it('askHandler que lança erro resulta em deny', async () => {
        const ask = vi.fn().mockRejectedValue(new Error('boom'));
        const hooks = createHooks({ allowTools: ['read_file'], onPermissionAsk: ask });
        const result = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
    });

    it('argsModifier modifica args quando retorna objeto', async () => {
        const modifier = vi.fn().mockReturnValue({ modified: true });
        const hooks = createHooks({ argsModifier: modifier });
        const result = await hooks.onPreToolUse(makeInput('read_file', { path: '/x' }), makeInvocation());
        expect(result.permissionDecision).toBe('allow');
        expect(result.modifiedArgs).toEqual({ modified: true });
    });

    it('argsModifier ignorado quando retorna null', async () => {
        const modifier = vi.fn().mockReturnValue(null);
        const hooks = createHooks({ argsModifier: modifier });
        const result = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(result.permissionDecision).toBe('allow');
        expect(result.modifiedArgs).toBeUndefined();
    });

    it('toolName desconhecido usa fallback "unknown"', async () => {
        const hooks = createHooks({ debugTools: true });
        const result = await hooks.onPreToolUse({}, makeInvocation());
        expect(result.permissionDecision).toBe('allow');
    });
});

// ─── ErrorOccurred handler ───────────────────────────────────────────────────

describe('hooks/factory › onErrorOccurred', () => {
    it('retorna retry para model_call recuperável', async () => {
        const hooks = createHooks();
        const result = await hooks.onErrorOccurred(
            { error: 'rate_limit', errorContext: 'model_call', recoverable: true },
            makeInvocation(),
        );
        expect(result.errorHandling).toBe('retry');
        expect(result.retryCount).toBe(3);
    });

    it('retorna skip para tool_execution recuperável', async () => {
        const hooks = createHooks();
        const result = await hooks.onErrorOccurred(
            { error: 'tool failed', errorContext: 'tool_execution', recoverable: true },
            makeInvocation(),
        );
        expect(result.errorHandling).toBe('skip');
    });

    it('retorna abort para erro não-recuperável', async () => {
        const hooks = createHooks();
        const result = await hooks.onErrorOccurred(
            { error: 'fatal', errorContext: 'unknown', recoverable: false },
            makeInvocation(),
        );
        expect(result.errorHandling).toBe('abort');
    });
});

// ─── Presets ─────────────────────────────────────────────────────────────────

describe('hooks/factory › presets', () => {
    it('createMinimalHooks retorna hooks com debugTools ativo', () => {
        const hooks = createMinimalHooks();
        expect(hooks.onPreToolUse).toBeTypeOf('function');
        expect(hooks.onErrorOccurred).toBeTypeOf('function');
    });

    it('createAuditHooks retorna todos os 6 handlers', () => {
        const hooks = createAuditHooks();
        expect(hooks.onPreToolUse).toBeTypeOf('function');
        expect(hooks.onPostToolUse).toBeTypeOf('function');
        expect(hooks.onUserPromptSubmitted).toBeTypeOf('function');
        expect(hooks.onSessionStart).toBeTypeOf('function');
        expect(hooks.onSessionEnd).toBeTypeOf('function');
        expect(hooks.onErrorOccurred).toBeTypeOf('function');
    });

    it('createDenyAllHooks nega qualquer tool', async () => {
        const hooks = createDenyAllHooks();
        const result = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
    });

    it('createSafeHooks permite read_file, nega bash', async () => {
        const hooks = createSafeHooks();
        const allow = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(allow.permissionDecision).toBe('allow');
        const deny = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(deny.permissionDecision).toBe('deny');
    });

    it('createSafeHooks aceita extra allowed tools', async () => {
        const hooks = createSafeHooks(['web_search']);
        const result = await hooks.onPreToolUse(makeInput('web_search'), makeInvocation());
        expect(result.permissionDecision).toBe('allow');
    });
});

// ─── composePreToolUseHandlers ───────────────────────────────────────────────

describe('hooks/factory › composePreToolUseHandlers', () => {
    it('primeiro handler com decisão encerra a cadeia', async () => {
        const h1 = vi.fn().mockResolvedValue({ permissionDecision: 'deny' });
        const h2 = vi.fn().mockResolvedValue({ permissionDecision: 'allow' });
        const composed = composePreToolUseHandlers(h1, h2);
        const result = await composed(makeInput('bash'), makeInvocation());
        expect(result.permissionDecision).toBe('deny');
        expect(h2).not.toHaveBeenCalled();
    });

    it('handler sem decisão passa para o próximo', async () => {
        const h1 = vi.fn().mockResolvedValue(undefined);
        const h2 = vi.fn().mockResolvedValue({ permissionDecision: 'allow' });
        const composed = composePreToolUseHandlers(h1, h2);
        const result = await composed(makeInput('bash'), makeInvocation());
        expect(result.permissionDecision).toBe('allow');
    });

    it('retorna undefined se nenhum handler decide', async () => {
        const h1 = vi.fn().mockResolvedValue(undefined);
        const composed = composePreToolUseHandlers(h1);
        const result = await composed(makeInput('bash'), makeInvocation());
        expect(result).toBeUndefined();
    });
});

// ─── createErrorNotifierHook ─────────────────────────────────────────────────

describe('hooks/factory › createErrorNotifierHook', () => {
    it('delega ao callback com todos os parâmetros', async () => {
        const cb = vi.fn();
        const hook = createErrorNotifierHook(cb);
        await hook({ error: 'boom', errorContext: 'model_call', recoverable: true }, makeInvocation('sess-42'));
        expect(cb).toHaveBeenCalledWith('boom', 'model_call', true, 'sess-42');
    });

    it('sessionId default vazio se invocation sem id', async () => {
        const cb = vi.fn();
        const hook = createErrorNotifierHook(cb);
        await hook({ error: 'x', errorContext: 'y', recoverable: false }, {});
        expect(cb).toHaveBeenCalledWith('x', 'y', false, '');
    });
});
