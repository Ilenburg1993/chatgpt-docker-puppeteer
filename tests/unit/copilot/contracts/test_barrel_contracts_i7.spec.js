// @ts-check
/**
 * FI-7 — Contract tests round 2 — Barrel contracts para novos módulos.
 *
 * Valida os contratos nominais dos barrels promovidos na Faixa I. Package-import exactness e audiences são
 * governados pelo parser canônico em `scripts/lib/copilot-package-imports.mjs`.
 */
import { describe, expect, it, vi } from 'vitest';

// ─── Mocks genéricos para dependências pesadas ──────────────────────────

vi.mock('@github/copilot-sdk', () => ({
    SYSTEM_MESSAGE_SECTIONS: Object.freeze({ identity: 'identity' }),
    SYSTEM_PROMPT_SECTIONS: Object.freeze({ identity: 'identity' }),
    CopilotClient: vi.fn(),
    defineTool: vi.fn(() => ({ name: 'mock-tool', description: 'mock', schema: {}, handler: async () => ({}) })),
    approveAll: vi.fn(),
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
}));

// ═════════════════════════════════════════════════════════════════════════════
// 1. config barrel contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FI-7 — config barrel contract', () => {
    it('exports system-prompt builders', async () => {
        const barrel = await import('#copilot/config');
        const expected = ['buildAlwaysAliveSystemMessage', 'buildAppendSystemMessage', 'buildReplaceSystemMessage'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });

    it('exports env constants', async () => {
        const barrel = await import('#copilot/config');
        // Spot-check: alguns dos ~97 exports de env.js
        const expected = ['DEFAULT_EXCLUDED_TOOLS', 'ResumeSessionConfigBuilder', 'sanitizeResumeSessionConfig'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. observability barrel contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FI-7 — observability barrel contract', () => {
    it('exports logging facades', async () => {
        const barrel = await import('#copilot/observability');
        // log é a função principal exportada pelo logger
        expect(barrel.log, 'missing: log').toBeDefined();
    });

    it('exports event-collector functions (added in I-2)', async () => {
        const barrel = await import('#copilot/observability');
        const expected = ['attachSdkEventTyped'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });

    it('exports tool-stats functions (added in I-2)', async () => {
        const barrel = await import('#copilot/observability');
        const expected = ['getToolStats', 'recordToolCall', 'recordBlockedToolCall'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. hooks barrel contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FI-7 — hooks barrel contract', () => {
    it('exports all hook categories', async () => {
        const barrel = await import('#copilot/hooks');
        const expected = [
            'HookBus',
            'defaultBus',
            'attachBus',
            'HookRegistry',
            'SDK_HOOKS',
            'createHooks',
            'createPermissionHandler',
            'createSessionHooks',
            'composeHandlers',
            'pipeline',
            'createProductionHooks',
        ];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. audit barrel contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FI-7 — audit barrel contract', () => {
    it('exports pipeline and ring buffer', async () => {
        const barrel = await import('#copilot/audit');
        const expected = [
            'AuditRingBuffer',
            'globalAuditBuffer',
            'defaultAuditLog',
            'createAuditLog',
            'getAuditTail',
            'buildAuditingPermissionHandler',
            'isHighRiskTool',
            'logToolAudit',
        ];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. bridges barrel contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FI-7 — bridges barrel contract', () => {
    it('exports git-bridge functions', async () => {
        const barrel = await import('#copilot/bridges');
        const expected = ['gitLog', 'gitStatus', 'gitCommit', 'gitPush', 'gitPull'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });

    it('exports mcp and nerv bridge functions', async () => {
        const barrel = await import('#copilot/bridges');
        const expected = ['getMcpStatus', 'emitNerv', 'nervEventBusAdapter'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });

    it('exports gh bridge functions (added in I-5)', async () => {
        const barrel = await import('#copilot/bridges');
        const expected = ['listIssues', 'listPrs', 'listRuns'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });
});
