// @ts-check
import { describe, it, beforeEach } from 'node:test';
/**
 * tests/unit/copilot/sdk/test_sdk_permissions.spec.js
 *
 * Testes para src/copilot/sdk/permissions.js (Faixa 2 / F7-F9). Cobre: approveAll re-export, createPermissionHandler,
 * createAllowlistPermissionHandler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('#copilot/observability/logger', () => ({ log: vi.fn() }));

// Mock approveAll + SYSTEM_PROMPT_SECTIONS (necessário para barrel import)
vi.mock('@github/copilot-sdk', () => ({
    approveAll: vi.fn(async () => ({ kind: 'approved' })),
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
    /** @type {typeof import('../../../../src/copilot/sdk/permissions.js')} */
    let perms;

    beforeEach(async () => {
        vi.clearAllMocks();
        perms = await import('../../../../src/copilot/sdk/permissions.js');
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
            expect(result.kind).toBe('approved');
        });

        it('allowAll: true, aprova tudo', async () => {
            const handler = perms.createPermissionHandler({ allowAll: true });
            const result = await handler(makeRequest('shell'), { sessionId: 's1' });
            expect(result.kind).toBe('approved');
        });

        it('allowTools whitelist: aprova tools na lista', async () => {
            const handler = perms.createPermissionHandler({
                allowTools: ['read_file', 'write_file'],
            });
            const approved = await handler(makeRequest('read_file'), { sessionId: 's1' });
            expect(approved.kind).toBe('approved');
        });

        it('allowTools whitelist: nega tools fora da lista', async () => {
            const handler = perms.createPermissionHandler({
                allowTools: ['read_file'],
            });
            const denied = await handler(makeRequest('shell'), { sessionId: 's1' });
            expect(denied.kind).toBe('denied-by-rules');
        });

        it('denyTools: nega tools na blacklist', async () => {
            const handler = perms.createPermissionHandler({
                denyTools: ['dangerous_tool'],
            });
            const denied = await handler(makeRequest('dangerous_tool'), { sessionId: 's1' });
            expect(denied.kind).toBe('denied-by-rules');
        });

        it('denyTools: aprova tools fora da blacklist', async () => {
            const handler = perms.createPermissionHandler({
                denyTools: ['dangerous_tool'],
            });
            const approved = await handler(makeRequest('safe_tool'), { sessionId: 's1' });
            expect(approved.kind).toBe('approved');
        });

        it('denyPatterns: nega tools com match no regex', async () => {
            const handler = perms.createPermissionHandler({
                denyPatterns: [/^shell/],
            });
            const denied = await handler(makeRequest('shell_exec'), { sessionId: 's1' });
            expect(denied.kind).toBe('denied-by-rules');
        });

        it('denyPatterns: aprova tools sem match no regex', async () => {
            const handler = perms.createPermissionHandler({
                denyPatterns: [/^shell/],
            });
            const approved = await handler(makeRequest('read_file'), { sessionId: 's1' });
            expect(approved.kind).toBe('approved');
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
                onRequest: () => /** @type {any} */ ({ kind: 'denied-by-rules', rules: ['custom'] }),
            });
            const result = await handler(makeRequest('any'), { sessionId: 's1' });
            expect(result.kind).toBe('denied-by-rules');
        });

        it('onRequest: retorno undefined delega para lógica padrão', async () => {
            const handler = perms.createPermissionHandler({
                onRequest: () => undefined,
            });
            const result = await handler(makeRequest('safe_tool'), { sessionId: 's1' });
            expect(result.kind).toBe('approved');
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
            expect(result.kind).toBe('approved');
        });

        it('nega tools não listadas', async () => {
            const handler = perms.createAllowlistPermissionHandler(['read_file']);
            const result = await handler(makeRequest('shell'), { sessionId: 's1' });
            expect(result.kind).toBe('denied-by-rules');
        });

        it('lança TypeError se não receber array', () => {
            expect(() => perms.createAllowlistPermissionHandler(/** @type {any} */ ('not-an-array'))).toThrow(
                TypeError,
            );
        });

        it('lista vazia nega tudo', async () => {
            const handler = perms.createAllowlistPermissionHandler([]);
            const result = await handler(makeRequest('any'), { sessionId: 's1' });
            expect(result.kind).toBe('denied-by-rules');
        });
    });

    // ─── Barrel re-export ─────────────────────────────────────────────────────

    describe('sdk/index.js barrel re-exports permissions', () => {
        it('re-exporta approveAll e createAllowlistPermissionHandler', async () => {
            const barrel = await import('../../../../src/copilot/sdk/index.js');
            expect(typeof barrel.approveAll).toBe('function');
            expect(typeof barrel.createAllowlistPermissionHandler).toBe('function');
            // createPermissionHandler já exportada via #copilot/hooks/permission no barrel
            expect(typeof barrel.createPermissionHandler).toBe('function');
        });
    });
});
