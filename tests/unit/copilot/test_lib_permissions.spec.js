// @ts-check
/**
 * Sprint 10 — Testes unitários de src/copilot/lib/permissions.js
 *
 * Cobre: createPermissionHandler (allowAll, whitelist, blacklist, patterns, onRequest, auditMode),
 * createApproveAllPermission, createAuditOnlyPermission, createRestrictedPermission, createSafePermission.
 *
 * SDK NAO requerido — testamos apenas a logica de permissoes (PermissionRequestResult kind-based).
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

// ─── helper: mock de PermissionRequest ───────────────────────────────────────

/** @param {string} toolName */
function makeRequest(toolName) {
    return /** @type {any} */ ({ toolName });
}

// ─── createPermissionHandler › allowAll ──────────────────────────────────────

describe('lib/permissions › createPermissionHandler', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/lib/permissions.js');
        assert.ok(typeof mod.createPermissionHandler === 'function');
    });
});

describe('lib/permissions › allowAll', () => {
    it('aprova qualquer tool quando allowAll=true', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ allowAll: true });
        const result = await handler(makeRequest('qualquer_tool'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });

    it('sem config: aprova por default', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler();
        const result = await handler(makeRequest('tool_x'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });
});

// ─── createPermissionHandler › whitelist ─────────────────────────────────────

describe('lib/permissions › allowTools (whitelist)', () => {
    it('aprova tool que esta na whitelist', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ allowTools: ['read_file', 'list_dir'] });
        const result = await handler(makeRequest('read_file'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });

    it('nega tool que NAO esta na whitelist', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ allowTools: ['read_file'] });
        const result = await handler(makeRequest('shell_exec'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'denied-by-rules');
    });
});

// ─── createPermissionHandler › denyTools ─────────────────────────────────────

describe('lib/permissions › denyTools (blacklist)', () => {
    it('nega tool que esta na blacklist', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ denyTools: ['exec', 'shell_run'] });
        const result = await handler(makeRequest('exec'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'denied-by-rules');
    });

    it('aprova tool que NAO esta na blacklist', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ denyTools: ['exec'] });
        const result = await handler(makeRequest('read_file'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });
});

// ─── createPermissionHandler › denyPatterns ──────────────────────────────────

describe('lib/permissions › denyPatterns', () => {
    it('nega tool que corresponder ao regex', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ denyPatterns: [/^shell/i] });
        const result = await handler(makeRequest('shell_exec'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'denied-by-rules');
    });

    it('aprova tool que NAO corresponder ao regex', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ denyPatterns: [/^shell/i] });
        const result = await handler(makeRequest('read_file'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });
});

// ─── createPermissionHandler › onRequest ─────────────────────────────────────

describe('lib/permissions › onRequest callback', () => {
    it('callback retornando true aprova', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ onRequest: async () => true });
        const result = await handler(makeRequest('any'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });

    it('callback retornando false nega', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({ onRequest: async () => false });
        const result = await handler(makeRequest('any'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'denied-by-rules');
    });

    it('callback retornando undefined delega para logica padrao', async () => {
        const { createPermissionHandler } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createPermissionHandler({
            onRequest: async () => undefined,
            allowAll: true,
        });
        const result = await handler(makeRequest('any'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });
});

// ─── helpers pre-configurados ─────────────────────────────────────────────────

describe('lib/permissions › createApproveAllPermission', () => {
    it('retorna uma funcao', async () => {
        const { createApproveAllPermission } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createApproveAllPermission();
        assert.ok(typeof handler === 'function');
    });
});

describe('lib/permissions › createAuditOnlyPermission', () => {
    it('aprova tools (nao bloqueia)', async () => {
        const { createAuditOnlyPermission } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createAuditOnlyPermission();
        const result = await handler(makeRequest('any_tool'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });
});

describe('lib/permissions › createRestrictedPermission', () => {
    it('aprova tools na lista', async () => {
        const { createRestrictedPermission } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createRestrictedPermission(['read_file', 'grep_search']);
        const result = await handler(makeRequest('grep_search'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });

    it('nega tools fora da lista', async () => {
        const { createRestrictedPermission } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createRestrictedPermission(['read_file']);
        const result = await handler(makeRequest('delete_file'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'denied-by-rules');
    });
});

describe('lib/permissions › createSafePermission', () => {
    it('nega run_shell_command', async () => {
        const { createSafePermission } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createSafePermission();
        const result = await handler(makeRequest('run_shell_command'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'denied-by-rules');
    });

    it('aprova read_file', async () => {
        const { createSafePermission } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createSafePermission();
        const result = await handler(makeRequest('read_file'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'approved');
    });

    it('nega tools adicionais fornecidas', async () => {
        const { createSafePermission } = await import('../../../src/copilot/lib/permissions.js');
        const handler = createSafePermission(['custom_dangerous_tool']);
        const result = await handler(makeRequest('custom_dangerous_tool'), { sessionId: 'test' });
        assert.strictEqual(result.kind, 'denied-by-rules');
    });
});
