// @ts-check
import { describe, it } from 'node:test';
/**
 * tests/unit/copilot/hooks/test_presets.spec.js
 *
 * Testes unitários para src/copilot/hooks/presets/*.js Cobre: minimal, deny-all, interactive, safe, audit, production
 */

import { describe, expect, it, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

vi.mock('#copilot/audit/pipeline', () => ({
    defaultAuditLog: {
        record: vi.fn(),
        getEntries: vi.fn(() => []),
        clear: vi.fn(),
    },
}));

vi.mock('#copilot/tools/introspection-tools', () => ({
    isToolDisabled: vi.fn(() => false),
}));

vi.mock('../../../src/copilot/hooks/permission-handler.js', () => ({
    createPermissionHandler: vi.fn(() => vi.fn().mockResolvedValue({ kind: 'approved' })),
}));

vi.mock('../../../src/copilot/hooks/error-handler.js', () => ({
    createCircuitBreakerHandler: vi.fn(() => vi.fn().mockResolvedValue({ errorHandling: 'retry', retryCount: 3 })),
}));

vi.mock('../../../src/copilot/hooks/prompt-transformer.js', () => ({
    createPromptTransformer: vi.fn(() => vi.fn().mockResolvedValue({})),
}));

import { createHooksAuditPreset } from '../../../../src/copilot/hooks/presets/audit.js';
import { createDenyAllPreset } from '../../../../src/copilot/hooks/presets/deny-all.js';
import { createInteractivePreset } from '../../../../src/copilot/hooks/presets/interactive.js';
import { createMinimalPreset } from '../../../../src/copilot/hooks/presets/minimal.js';
import { createProductionHooks } from '../../../../src/copilot/hooks/presets/production.js';
import { createSafePreset } from '../../../../src/copilot/hooks/presets/safe.js';

/** @param {string} toolName */
const makeInput = (toolName) => /** @type {any} */ ({ toolName, toolArgs: {} });

/** @param {string} [sid='sess-1'] Default is `'sess-1'` */
const makeInvocation = (sid = 'sess-1') => /** @type {any} */ ({ sessionId: sid });

const makePromptInput = (prompt = 'hello') => /** @type {any} */ ({ prompt });
const makeSessionStartInput = (source = 'chat') => /** @type {any} */ ({ source, cwd: '/tmp' });
const makeSessionEndInput = (reason = 'user_closed') => /** @type {any} */ ({ reason });
const makeErrorInput = (opts = {}) =>
    /** @type {any} */ ({
        error: 'some error',
        errorContext: 'tool_execution',
        recoverable: true,
        ...opts,
    });
const makePostToolInput = (toolName = 'read_file') =>
    /** @type {any} */ ({
        toolName,
        toolResult: 'ok',
    });

// ─── createMinimalPreset ────────────────────────────────────────────────────

describe('hooks/presets/minimal', () => {
    it('retorna hooks e onPermissionRequest', () => {
        const { hooks, onPermissionRequest } = createMinimalPreset();
        expect(hooks).toBeDefined();
        expect(hooks.onPreToolUse).toBeTypeOf('function');
        expect(hooks.onPostToolUse).toBeTypeOf('function');
        expect(hooks.onSessionStart).toBeTypeOf('function');
        expect(hooks.onSessionEnd).toBeTypeOf('function');
        expect(hooks.onErrorOccurred).toBeTypeOf('function');
        expect(onPermissionRequest).toBeTypeOf('function');
    });

    it('onPreToolUse permite qualquer tool', async () => {
        const { hooks } = createMinimalPreset();
        const r = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('onPostToolUse retorna objeto vazio', async () => {
        const { hooks } = createMinimalPreset();
        const r = await hooks.onPostToolUse(makePostToolInput(), makeInvocation());
        expect(r).toEqual({});
    });

    it('onErrorOccurred retorna skip', async () => {
        const { hooks } = createMinimalPreset();
        const r = await hooks.onErrorOccurred(makeErrorInput(), makeInvocation());
        expect(r.errorHandling).toBe('skip');
    });
});

// ─── createDenyAllPreset ────────────────────────────────────────────────────

describe('hooks/presets/deny-all', () => {
    it('onPreToolUse nega qualquer tool', async () => {
        const { hooks } = createDenyAllPreset();
        const r = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(r.permissionDecision).toBe('deny');
    });

    it('onPreToolUse permite tools na exceptTools', async () => {
        const { hooks } = createDenyAllPreset({ exceptTools: ['read_file', 'list_dir'] });
        const r = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('exceptTools é case-insensitive', async () => {
        const { hooks } = createDenyAllPreset({ exceptTools: ['Read_File'] });
        const r = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('tools não-excetuadas continuam deny', async () => {
        const { hooks } = createDenyAllPreset({ exceptTools: ['read_file'] });
        const r = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(r.permissionDecision).toBe('deny');
    });

    it('onSessionStart retorna additionalContext', async () => {
        const { hooks } = createDenyAllPreset();
        const r = await hooks.onSessionStart(makeSessionStartInput(), makeInvocation());
        expect(r.additionalContext).toContain('RESTRITO');
    });

    it('onErrorOccurred retorna abort', async () => {
        const { hooks } = createDenyAllPreset();
        const r = await hooks.onErrorOccurred(makeErrorInput(), makeInvocation());
        expect(r.errorHandling).toBe('abort');
    });
});

// ─── createInteractivePreset ────────────────────────────────────────────────

describe('hooks/presets/interactive', () => {
    it('auto-allow tools retornam allow', async () => {
        const { hooks } = createInteractivePreset();
        const r = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('tools não auto-allow retornam ask', async () => {
        const { hooks } = createInteractivePreset();
        const r = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(r.permissionDecision).toBe('ask');
    });

    it('auto-deny tools retornam deny', async () => {
        const { hooks } = createInteractivePreset({ autoDenyTools: ['rm_rf'] });
        const r = await hooks.onPreToolUse(makeInput('rm_rf'), makeInvocation());
        expect(r.permissionDecision).toBe('deny');
    });

    it('autoAllowTools adicionais são permitidas', async () => {
        const { hooks } = createInteractivePreset({ autoAllowTools: ['custom_safe'] });
        const r = await hooks.onPreToolUse(makeInput('custom_safe'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('onSessionStart retorna additionalContext com INTERATIVO', async () => {
        const { hooks } = createInteractivePreset();
        const r = await hooks.onSessionStart(makeSessionStartInput(), makeInvocation());
        expect(r.additionalContext).toContain('INTERATIVO');
    });

    it('onErrorOccurred com recoverable retorna retry count 1', async () => {
        const { hooks } = createInteractivePreset();
        const r = await hooks.onErrorOccurred(makeErrorInput({ recoverable: true }), makeInvocation());
        expect(r.errorHandling).toBe('retry');
        expect(r.retryCount).toBe(1);
    });

    it('onErrorOccurred com não-recuperável retorna skip', async () => {
        const { hooks } = createInteractivePreset();
        const r = await hooks.onErrorOccurred(makeErrorInput({ recoverable: false }), makeInvocation());
        expect(r.errorHandling).toBe('skip');
    });
});

// ─── createSafePreset ────────────────────────────────────────────────────────

describe('hooks/presets/safe', () => {
    it('read_file é permitido', async () => {
        const { hooks } = createSafePreset();
        // read_file não está nas listas DENY nem ASK → allow
        const r = await hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('bash retorna ask (destrutivo)', async () => {
        const { hooks } = createSafePreset();
        const r = await hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(r.permissionDecision).toBe('ask');
    });

    it('rm_rf é deny absoluto', async () => {
        const { hooks } = createSafePreset();
        const r = await hooks.onPreToolUse(makeInput('rm_rf'), makeInvocation());
        expect(r.permissionDecision).toBe('deny');
    });

    it('extraDenyTools são adicionadas ao deny', async () => {
        const { hooks } = createSafePreset({ extraDenyTools: ['custom_danger'] });
        const r = await hooks.onPreToolUse(makeInput('custom_danger'), makeInvocation());
        expect(r.permissionDecision).toBe('deny');
    });

    it('askOnTools adicionais retornam ask', async () => {
        const { hooks } = createSafePreset({ askOnTools: ['deploy'] });
        const r = await hooks.onPreToolUse(makeInput('deploy'), makeInvocation());
        expect(r.permissionDecision).toBe('ask');
    });

    it('onErrorOccurred com recoverable retorna retry', async () => {
        const { hooks } = createSafePreset();
        const r = await hooks.onErrorOccurred(makeErrorInput({ recoverable: true }), makeInvocation());
        expect(r.errorHandling).toBe('retry');
        expect(r.retryCount).toBe(2);
    });

    it('onErrorOccurred sem recoverable retorna abort', async () => {
        const { hooks } = createSafePreset();
        const r = await hooks.onErrorOccurred(makeErrorInput({ recoverable: false }), makeInvocation());
        expect(r.errorHandling).toBe('abort');
    });
});

// ─── createHooksAuditPreset ─────────────────────────────────────────────────

describe('hooks/presets/audit', () => {
    it('retorna hooks, onPermissionRequest, getAuditTrail, clearAuditTrail', () => {
        const preset = createHooksAuditPreset();
        expect(preset.hooks).toBeDefined();
        expect(preset.onPermissionRequest).toBeTypeOf('function');
        expect(preset.getAuditTrail).toBeTypeOf('function');
        expect(preset.clearAuditTrail).toBeTypeOf('function');
    });

    it('onPreToolUse permite e registra no audit', async () => {
        const { defaultAuditLog } = await import('#copilot/audit/pipeline');
        vi.mocked(defaultAuditLog.record).mockClear();
        const preset = createHooksAuditPreset();
        const r = await preset.hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
        expect(defaultAuditLog.record).toHaveBeenCalled();
    });

    it('onPostToolUse registra no audit', async () => {
        const { defaultAuditLog } = await import('#copilot/audit/pipeline');
        vi.mocked(defaultAuditLog.record).mockClear();
        const preset = createHooksAuditPreset();
        await preset.hooks.onPostToolUse(makePostToolInput(), makeInvocation());
        expect(defaultAuditLog.record).toHaveBeenCalled();
    });

    it('onErrorOccurred retorna skip', async () => {
        const preset = createHooksAuditPreset();
        const r = await preset.hooks.onErrorOccurred(makeErrorInput(), makeInvocation());
        expect(r.errorHandling).toBe('skip');
    });

    it('aceita permissionHandler customizado', () => {
        const customHandler = vi.fn();
        const preset = createHooksAuditPreset({ permissionHandler: /** @type {any} */ (customHandler) });
        expect(preset.onPermissionRequest).toBe(customHandler);
    });
});

// ─── createProductionHooks ──────────────────────────────────────────────────

describe('hooks/presets/production', () => {
    it('retorna hooks e onPermissionRequest', () => {
        const { hooks, onPermissionRequest } = createProductionHooks();
        expect(hooks.onPreToolUse).toBeTypeOf('function');
        expect(hooks.onPostToolUse).toBeTypeOf('function');
        expect(hooks.onUserPromptSubmitted).toBeTypeOf('function');
        expect(hooks.onSessionStart).toBeTypeOf('function');
        expect(hooks.onSessionEnd).toBeTypeOf('function');
        expect(hooks.onErrorOccurred).toBeTypeOf('function');
        expect(onPermissionRequest).toBeTypeOf('function');
    });

    it('sem allowList, permite qualquer tool', () => {
        const { hooks } = createProductionHooks();
        const r = hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('com toolDenyList, nega tool listada', () => {
        const { hooks } = createProductionHooks({ toolDenyList: ['bash'] });
        const r = hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(r.permissionDecision).toBe('deny');
    });

    it('com toolAllowList, pede ask para tool não listada', () => {
        const { hooks } = createProductionHooks({ toolAllowList: ['read_file'] });
        const r = hooks.onPreToolUse(makeInput('bash'), makeInvocation());
        expect(r.permissionDecision).toBe('ask');
    });

    it('com toolAllowList, permite tool listada', () => {
        const { hooks } = createProductionHooks({ toolAllowList: ['read_file'] });
        const r = hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(r.permissionDecision).toBe('allow');
    });

    it('onPostToolUse com resultado pequeno retorna vazio', () => {
        const { hooks } = createProductionHooks();
        const r = hooks.onPostToolUse(makePostToolInput(), makeInvocation());
        expect(r).toEqual({});
    });

    it('onPostToolUse com resultado grande retorna additionalContext', () => {
        const { hooks } = createProductionHooks();
        const bigResult = { content: 'x'.repeat(60_000) };
        const r = hooks.onPostToolUse(
            /** @type {any} */ ({ toolName: 'read_file', toolResult: bigResult }),
            makeInvocation(),
        );
        expect(r.additionalContext).toContain('truncado');
    });

    it('onSessionStart retorna additionalContext com metadados', () => {
        const { hooks } = createProductionHooks();
        const r = hooks.onSessionStart(makeSessionStartInput(), makeInvocation());
        expect(r.additionalContext).toContain('production');
        expect(r.additionalContext).toContain('cwd=');
    });

    it('auditSink customizado é chamado', () => {
        const sink = vi.fn();
        const { hooks } = createProductionHooks({ auditSink: sink });
        hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(sink).toHaveBeenCalledWith(expect.objectContaining({ hookName: 'onPreToolUse' }));
    });

    it('bus.emit é chamado quando bus fornecido', () => {
        const bus = { emit: vi.fn() };
        const { hooks } = createProductionHooks({ bus });
        hooks.onPreToolUse(makeInput('read_file'), makeInvocation());
        expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ hookName: 'pre_tool_use' }));
    });

    it('auditSink que lança erro não propaga', () => {
        const sink = vi.fn(() => {
            throw new Error('sink fail');
        });
        const { hooks } = createProductionHooks({ auditSink: sink });
        expect(() => hooks.onPreToolUse(makeInput('bash'), makeInvocation())).not.toThrow();
    });

    it('tool desabilitada por isToolDisabled é deny', async () => {
        const { isToolDisabled } = await import('#copilot/tools/introspection-tools');
        vi.mocked(isToolDisabled).mockReturnValueOnce(true);
        const { hooks } = createProductionHooks();
        const r = hooks.onPreToolUse(makeInput('disabled_tool'), makeInvocation());
        expect(r.permissionDecision).toBe('deny');
    });
});
