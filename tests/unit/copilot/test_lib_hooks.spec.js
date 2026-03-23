// @ts-check
/**
 * Sprint 11 — Testes unitários de src/copilot/lib/hooks.js
 *
 * Cobre: createHooks (padrão, auditLog, allowTools, denyTools, denyPatterns), presets (createMinimalHooks,
 * createAuditHooks, createDenyAllHooks, createSafeHooks), utilitários (composePreToolUseHandlers,
 * createErrorNotifierHook).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
    composePreToolUseHandlers,
    createAuditHooks,
    createDenyAllHooks,
    createErrorNotifierHook,
    createHooks,
    createMinimalHooks,
    createSafeHooks,
} from '../../../src/copilot/lib/hooks.js';

// ─── Helpers de mock ──────────────────────────────────────────────────────────

/**
 * @param {string} toolName
 * @returns {import('@github/copilot-sdk').PreToolUseHookInput}
 */
function makePreInput(toolName) {
    return /** @type {any} */ ({ toolName, toolArgs: {}, timestamp: Date.now(), cwd: '/tmp' });
}

/**
 * @param {string} toolName
 * @returns {import('@github/copilot-sdk').PostToolUseHookInput}
 */
function makePostInput(toolName) {
    return /** @type {any} */ ({
        toolName,
        toolArgs: {},
        toolResult: { content: 'ok' },
        timestamp: Date.now(),
        cwd: '/tmp',
    });
}

/** @param {string} sessionId */
const makeInvocation = (sessionId = 'sess-test-001') => ({ sessionId });

// ─── createHooks — padrão (sem config) ───────────────────────────────────────

describe('lib/hooks › createHooks › padrão', () => {
    it('retorna objeto com onPreToolUse definido', () => {
        const hooks = createHooks();
        assert.ok(typeof hooks.onPreToolUse === 'function', 'onPreToolUse deve ser função');
    });

    it('onPreToolUse permite qualquer tool se allowTools nao definido', async () => {
        const hooks = createHooks();
        const result = await hooks.onPreToolUse(makePreInput('qualquer_tool'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });

    it('onPreToolUse retorna allow para tool conhecida', async () => {
        const hooks = createHooks({ allowTools: ['read_file', 'list_dir'] });
        const result = await hooks.onPreToolUse(makePreInput('read_file'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });

    it('onPreToolUse retorna deny para tool fora da whitelist', async () => {
        const hooks = createHooks({ allowTools: ['read_file'] });
        const result = await hooks.onPreToolUse(makePreInput('shell_exec'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('denyTools tem precedencia sobre allowTools', async () => {
        const hooks = createHooks({ allowTools: ['read_file'], denyTools: ['read_file'] });
        const result = await hooks.onPreToolUse(makePreInput('read_file'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('denyPatterns bloqueia por regex', async () => {
        const hooks = createHooks({ denyPatterns: [/^shell_/] });
        const result = await hooks.onPreToolUse(makePreInput('shell_exec'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('denyPatterns nao bloqueia tool que nao faz match', async () => {
        const hooks = createHooks({ denyPatterns: [/^shell_/] });
        const result = await hooks.onPreToolUse(makePreInput('read_file'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });
});

// ─── createHooks — auditLog ───────────────────────────────────────────────────

describe('lib/hooks › createHooks › auditLog', () => {
    it('com auditLog true, onPostToolUse é definido', () => {
        const hooks = createHooks({ auditLog: true });
        assert.ok(typeof hooks.onPostToolUse === 'function', 'onPostToolUse deve ser função com auditLog');
    });

    it('sem auditLog, onPostToolUse nao é definido por padrão', () => {
        const hooks = createHooks({ auditLog: false });
        assert.strictEqual(hooks.onPostToolUse, undefined);
    });

    it('com auditLog true, onSessionStart é definido', () => {
        const hooks = createHooks({ auditLog: true });
        assert.ok(typeof hooks.onSessionStart === 'function');
    });

    it('com auditLog true, onSessionEnd é definido', () => {
        const hooks = createHooks({ auditLog: true });
        assert.ok(typeof hooks.onSessionEnd === 'function');
    });

    it('com auditLog true, onUserPromptSubmitted é definido', () => {
        const hooks = createHooks({ auditLog: true });
        assert.ok(typeof hooks.onUserPromptSubmitted === 'function');
    });

    it('onErrorOccurred sempre definido (independente de auditLog)', () => {
        const hooksOff = createHooks({ auditLog: false });
        const hooksOn = createHooks({ auditLog: true });
        assert.ok(typeof hooksOff.onErrorOccurred === 'function');
        assert.ok(typeof hooksOn.onErrorOccurred === 'function');
    });
});

// ─── createHooks — handlers customizados ─────────────────────────────────────

describe('lib/hooks › createHooks › handlers customizados', () => {
    it('onPreToolUse customizado substitui o padrão', async () => {
        /** @type {import('@github/copilot-sdk').PreToolUseHandler} */
        const customPre = async () => ({ permissionDecision: 'ask' });
        const hooks = createHooks({ onPreToolUse: customPre });
        const result = await hooks.onPreToolUse(makePreInput('any_tool'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'ask');
    });

    it('onErrorOccurred customizado substituí o padrão', async () => {
        let captured = '';
        /** @type {import('@github/copilot-sdk').ErrorOccurredHandler} */
        const customErr = async (input) => {
            captured = input.error;
        };
        const hooks = createHooks({ onErrorOccurred: customErr });
        await hooks.onErrorOccurred(
            /** @type {any} */ ({
                error: 'test-error',
                errorContext: 'system',
                recoverable: false,
                timestamp: 0,
                cwd: '/',
            }),
            makeInvocation(),
        );
        assert.strictEqual(captured, 'test-error');
    });
});

// ─── createMinimalHooks ───────────────────────────────────────────────────────

describe('lib/hooks › createMinimalHooks', () => {
    it('retorna hooks com onPreToolUse', () => {
        const hooks = createMinimalHooks();
        assert.ok(typeof hooks.onPreToolUse === 'function');
    });

    it('permite qualquer tool (sem restricoes)', async () => {
        const hooks = createMinimalHooks();
        const result = await hooks.onPreToolUse(makePreInput('rm_rf'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });
});

// ─── createAuditHooks ─────────────────────────────────────────────────────────

describe('lib/hooks › createAuditHooks', () => {
    it('retorna todos os 6 hooks', () => {
        const hooks = createAuditHooks();
        assert.ok(typeof hooks.onPreToolUse === 'function');
        assert.ok(typeof hooks.onPostToolUse === 'function');
        assert.ok(typeof hooks.onUserPromptSubmitted === 'function');
        assert.ok(typeof hooks.onSessionStart === 'function');
        assert.ok(typeof hooks.onSessionEnd === 'function');
        assert.ok(typeof hooks.onErrorOccurred === 'function');
    });

    it('onPostToolUse pode ser chamado sem erro', async () => {
        const hooks = createAuditHooks();
        const result = await hooks.onPostToolUse(makePostInput('read_file'), makeInvocation());
        assert.ok(result === undefined || typeof result === 'object');
    });
});

// ─── createDenyAllHooks ───────────────────────────────────────────────────────

describe('lib/hooks › createDenyAllHooks', () => {
    it('nega qualquer ferramenta', async () => {
        const hooks = createDenyAllHooks();
        const result = await hooks.onPreToolUse(makePreInput('read_file'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('nega mesmo ferramentas "seguras"', async () => {
        const hooks = createDenyAllHooks();
        const result = await hooks.onPreToolUse(makePreInput('list_dir'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });
});

// ─── createSafeHooks ──────────────────────────────────────────────────────────

describe('lib/hooks › createSafeHooks', () => {
    it('permite read_file (na whitelist padrao)', async () => {
        const hooks = createSafeHooks();
        const result = await hooks.onPreToolUse(makePreInput('read_file'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });

    it('nega shell_exec (fora da whitelist)', async () => {
        const hooks = createSafeHooks();
        const result = await hooks.onPreToolUse(makePreInput('shell_exec'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('permite tool extra passada como argumento', async () => {
        const hooks = createSafeHooks(['minha_tool_segura']);
        const result = await hooks.onPreToolUse(makePreInput('minha_tool_segura'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'allow');
    });
});

// ─── composePreToolUseHandlers ─────────────────────────────────────────────────

describe('lib/hooks › composePreToolUseHandlers', () => {
    it('usa primeiro handler que retorna permissionDecision', async () => {
        /** @type {import('@github/copilot-sdk').PreToolUseHandler} */
        const h1 = async () => undefined;
        /** @type {import('@github/copilot-sdk').PreToolUseHandler} */
        const h2 = async () => ({ permissionDecision: 'deny' });
        /** @type {import('@github/copilot-sdk').PreToolUseHandler} */
        const h3 = async () => ({ permissionDecision: 'allow' });

        const composed = composePreToolUseHandlers(h1, h2, h3);
        const result = await composed(makePreInput('tool'), makeInvocation());
        assert.strictEqual(result?.permissionDecision, 'deny');
    });

    it('retorna undefined se nenhum handler retornar decisao', async () => {
        /** @type {import('@github/copilot-sdk').PreToolUseHandler} */
        const h1 = async () => undefined;
        /** @type {import('@github/copilot-sdk').PreToolUseHandler} */
        const h2 = async () => undefined;

        const composed = composePreToolUseHandlers(h1, h2);
        const result = await composed(makePreInput('tool'), makeInvocation());
        assert.strictEqual(result, undefined);
    });
});

// ─── createErrorNotifierHook ──────────────────────────────────────────────────

describe('lib/hooks › createErrorNotifierHook', () => {
    it('chama callback com os parametros corretos', async () => {
        /** @type {{ error: string; context: string; recoverable: boolean; sessionId: string } | null} */
        let captured = null;

        const hook = createErrorNotifierHook((error, context, recoverable, sessionId) => {
            captured = { error, context, recoverable, sessionId };
        });

        await hook(
            /** @type {any} */ ({
                error: 'falha-teste',
                errorContext: 'tool_execution',
                recoverable: true,
                timestamp: 0,
                cwd: '/',
            }),
            { sessionId: 'sess-notify-test' },
        );

        assert.ok(captured !== null);
        assert.strictEqual(captured.error, 'falha-teste');
        assert.strictEqual(captured.context, 'tool_execution');
        assert.strictEqual(captured.recoverable, true);
        assert.strictEqual(captured.sessionId, 'sess-notify-test');
    });
});
