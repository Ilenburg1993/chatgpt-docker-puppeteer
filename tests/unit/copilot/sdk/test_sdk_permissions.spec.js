// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_permissions.spec.js
 *
 * Testes para src/copilot/sdk/permissions.js (Faixa 2 / F7-F9). Cobre: approveAll re-export, createPermissionHandler,
 * createAllowlistPermissionHandler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLog } = vi.hoisted(() => ({ mockLog: vi.fn() }));

// Mock logger — observability barrel (para imports indiretos)
vi.mock('#copilot/observability/logger', () => ({
    log: mockLog,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

// sdk/permissions.js importa log de ./logger.js (DI local)
vi.mock('../../../../src/copilot/sdk/logger.js', () => ({
    log: mockLog,
    setSdkLogger: vi.fn(),
}));

// Mock approveAll + SYSTEM_PROMPT_SECTIONS (necessário para barrel import)
vi.mock('@github/copilot-sdk', () => ({
    approveAll: vi.fn(async () => ({ kind: 'approve-once' })),
    SYSTEM_PROMPT_SECTIONS: {
        identity: { description: 'Identity' },
        tone: { description: 'Tone' },
        tool_efficiency: { description: 'Tool efficiency' },
        environment_context: { description: 'Environment' },
        code_change_rules: { description: 'Code changes' },
        guidelines: { description: 'Guidelines' },
        safety: { description: 'Safety' },
        tool_instructions: { description: 'Tool instructions' },
        custom_instructions: { description: 'Custom instructions' },
        last_instructions: { description: 'Last instructions' },
    },
    defineTool: vi.fn((name, config) => ({ name, ...config })),
}));

describe('sdk/permissions.js', () => {
    /** @type {typeof import('../../../../src/copilot/sdk/session/permissions.js')} */
    let perms;

    beforeEach(async () => {
        vi.clearAllMocks();
        perms = await import('../../../../src/copilot/sdk/session/permissions.js');
    });

    // ─── approveAll re-export ─────────────────────────────────────────────────

    describe('approveAll re-export', () => {
        it('é uma função', () => {
            expect(typeof perms.approveAll).toBe('function');
        });
    });

    // ─── createPermissionHandler ──────────────────────────────────────────────

    describe('createPermissionHandler()', () => {
        /** @param {string} toolName */
        function makeRequest(toolName) {
            return /** @type {any} */ ({ kind: 'shell', toolName });
        }

        it('sem config, aprova por padrão', async () => {
            const handler = perms.createPermissionHandler();
            const result = await handler(makeRequest('any_tool'), { sessionId: 's1' });
            expect(result.kind).toBe('approve-once');
        });

        it('allowAll: true, aprova tudo', async () => {
            const handler = perms.createPermissionHandler({ allowAll: true });
            const result = await handler(makeRequest('shell'), { sessionId: 's1' });
            expect(result.kind).toBe('approve-once');
        });

        it('allowTools whitelist: aprova tools na lista', async () => {
            const handler = perms.createPermissionHandler({
                allowTools: ['read_file', 'write_file'],
            });
            const approved = await handler(makeRequest('read_file'), { sessionId: 's1' });
            expect(approved.kind).toBe('approve-once');
        });

        it('allowTools whitelist: nega tools fora da lista', async () => {
            const handler = perms.createPermissionHandler({
                allowTools: ['read_file'],
            });
            const denied = await handler(makeRequest('shell'), { sessionId: 's1' });
            expect(denied.kind).toBe('reject');
        });

        it('denyTools: nega tools na blacklist', async () => {
            const handler = perms.createPermissionHandler({
                denyTools: ['dangerous_tool'],
            });
            const denied = await handler(makeRequest('dangerous_tool'), { sessionId: 's1' });
            expect(denied.kind).toBe('reject');
        });

        it('denyTools: aprova tools fora da blacklist', async () => {
            const handler = perms.createPermissionHandler({
                denyTools: ['dangerous_tool'],
            });
            const approved = await handler(makeRequest('safe_tool'), { sessionId: 's1' });
            expect(approved.kind).toBe('approve-once');
        });

        it('denyKinds: nega pelo kind canônico do SDK antes de allowAll', async () => {
            const handler = perms.createPermissionHandler({
                allowAll: true,
                denyKinds: ['shell'],
            });
            const denied = await handler(/** @type {any} */ ({ kind: 'shell', toolCallId: 'tc-1' }), {
                sessionId: 's1',
            });
            expect(denied.kind).toBe('reject');
        });

        it('denyPatterns: nega tools com match no regex', async () => {
            const handler = perms.createPermissionHandler({
                denyPatterns: [/^shell/],
            });
            const denied = await handler(makeRequest('shell_exec'), { sessionId: 's1' });
            expect(denied.kind).toBe('reject');
        });

        it('denyPatterns: aprova tools sem match no regex', async () => {
            const handler = perms.createPermissionHandler({
                denyPatterns: [/^shell/],
            });
            const approved = await handler(makeRequest('read_file'), { sessionId: 's1' });
            expect(approved.kind).toBe('approve-once');
        });

        it('denyPatterns: lança TypeError se não for RegExp', () => {
            expect(() =>
                perms.createPermissionHandler({
                    denyPatterns: /** @type {any} */ (['not-a-regex']),
                }),
            ).toThrow(TypeError);
        });

        it('onRequest: override prevalece', async () => {
            const handler = perms.createPermissionHandler({
                onRequest: () => /** @type {any} */ ({ kind: 'reject', feedback: 'custom' }),
            });
            const result = await handler(makeRequest('any'), { sessionId: 's1' });
            expect(result.kind).toBe('reject');
        });

        it('onRequest: aceita boolean e normaliza resultado', async () => {
            const approvedHandler = perms.createPermissionHandler({ onRequest: () => true });
            const deniedHandler = perms.createPermissionHandler({ onRequest: () => false });

            await expect(approvedHandler(makeRequest('any'), { sessionId: 's1' })).resolves.toMatchObject({
                kind: 'approve-once',
            });
            await expect(deniedHandler(makeRequest('any'), { sessionId: 's1' })).resolves.toMatchObject({
                kind: 'reject',
            });
        });

        it('onRequest: recebe invocation completo', async () => {
            const spy = vi.fn(() => true);
            const handler = perms.createPermissionHandler({ onRequest: spy });
            await handler(makeRequest('any'), { sessionId: 'sess-123' });
            expect(spy).toHaveBeenCalledWith(expect.anything(), { sessionId: 'sess-123' });
        });

        it('onRequest: retorno undefined delega para lógica padrão', async () => {
            const handler = perms.createPermissionHandler({
                onRequest: () => undefined,
            });
            const result = await handler(makeRequest('safe_tool'), { sessionId: 's1' });
            expect(result.kind).toBe('approve-once');
        });

        it('onRequest: falha nega por segurança sem propagar exceção ao SDK', async () => {
            const handler = perms.createPermissionHandler({
                onRequest: () => {
                    throw new Error('boom');
                },
            });
            await expect(handler(makeRequest('safe_tool'), { sessionId: 's1' })).resolves.toMatchObject({
                kind: 'reject',
            });
            expect(mockLog).toHaveBeenCalledWith('WARN', expect.stringContaining('negando por segurança'));
        });

        it('auditMode: loga sem negar', async () => {
            const { log } = await import('#copilot/observability/logger');
            const handler = perms.createPermissionHandler({
                auditMode: true,
            });
            await handler(makeRequest('test_tool'), { sessionId: 's1' });
            expect(log).toHaveBeenCalled();
        });
    });

    // ─── createAllowlistPermissionHandler ─────────────────────────────────────

    describe('createAllowlistPermissionHandler()', () => {
        /** @param {string} toolName */
        function makeRequest(toolName) {
            return /** @type {any} */ ({ kind: 'shell', toolName });
        }

        it('aprova tools listadas', async () => {
            const handler = perms.createAllowlistPermissionHandler(['read_file', 'search']);
            const result = await handler(makeRequest('read_file'), { sessionId: 's1' });
            expect(result.kind).toBe('approve-once');
        });

        it('nega tools não listadas', async () => {
            const handler = perms.createAllowlistPermissionHandler(['read_file']);
            const result = await handler(makeRequest('shell'), { sessionId: 's1' });
            expect(result.kind).toBe('reject');
        });

        it('lança TypeError se não receber array', () => {
            expect(() => perms.createAllowlistPermissionHandler(/** @type {any} */ ('not-an-array'))).toThrow(
                TypeError,
            );
        });

        it('createPermissionHandler valida allowTools/denyTools como arrays de strings', () => {
            expect(() => perms.createPermissionHandler({ allowTools: /** @type {any} */ ('shell') })).toThrow(
                TypeError,
            );
            expect(() => perms.createPermissionHandler({ denyTools: /** @type {any} */ ([123]) })).toThrow(TypeError);
        });

        it('lista vazia nega tudo', async () => {
            const handler = perms.createAllowlistPermissionHandler([]);
            const result = await handler(makeRequest('any'), { sessionId: 's1' });
            expect(result.kind).toBe('reject');
        });
    });

    // ─── Barrel re-export ─────────────────────────────────────────────────────

    describe('sdk/index.js barrel re-exports permissions', () => {
        it('re-exporta approveAll e createAllowlistPermissionHandler', async () => {
            const barrel = await import('../../../../src/copilot/sdk/index.js');
            expect(typeof barrel.approveAll).toBe('function');
            expect(typeof barrel.createAllowlistPermissionHandler).toBe('function');
            // createPermissionHandler movido para #copilot/hooks/permission — não no barrel sdk
        });
    });
});
