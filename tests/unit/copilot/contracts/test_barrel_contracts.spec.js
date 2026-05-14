// @ts-check
/**
 * FG-3 — Testes de contrato entre módulos copilot.
 *
 * Valida que:
 *
 * 1. tools/index.js exporta as ferramentas esperadas (allTools, buildTool, withSkipPermission)
 * 2. core/index.js exporta contratos fundamentais (CopilotError, ConfigError, etc.)
 * 3. bridges/ não importa diretamente de agent/ (violação de camada L3→L4)
 */
import { describe, expect, it, vi } from 'vitest';

// ─── Mocks genéricos para dependências pesadas ──────────────────────────

vi.mock('@github/copilot-sdk', () => ({
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
// 1. tools barrel contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FG-3 — tools barrel contract', () => {
    it('exports allTools, buildTool, withSkipPermission', async () => {
        const barrel = await import('#copilot/tools/index');
        expect(barrel.allTools, 'missing allTools').toBeDefined();
        expect(barrel.buildTool, 'missing buildTool').toBeDefined();
        expect(barrel.withSkipPermission, 'missing withSkipPermission').toBeDefined();
    });

    it('allTools is an array', async () => {
        const barrel = await import('#copilot/tools/index');
        expect(Array.isArray(barrel.allTools)).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. core barrel contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FG-3 — core barrel contract', () => {
    it('exports fundamental error classes', async () => {
        const barrel = await import('#copilot/core/index');
        const expected = [
            'CopilotError',
            'ConfigError',
            'BridgeError',
            'TimeoutError',
            'SessionError',
            'ToolError',
            'ValidationError',
        ];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });

    it('exports resilience utilities', async () => {
        const barrel = await import('#copilot/core/index');
        const expected = ['withRetry', 'withTimeout', 'CircuitBreaker', 'wrapAsync'];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });

    it('exports shutdown management', async () => {
        const barrel = await import('#copilot/core/index');
        const expected = [
            'registerShutdownHandler',
            'runShutdown',
            'isShuttingDown',
            'getLastShutdownReport',
            'getShutdownLifecycleMetrics',
            'listShutdownHandlers',
            'listActiveTimers',
            'SHUTDOWN_PRIORITY',
            'setShutdownEventEmitter',
        ];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. layer violation guard — bridges must not import from agent
// ═════════════════════════════════════════════════════════════════════════════

describe('FG-3 — layer violation guard (bridges ↛ agent)', () => {
    it('bridges/ files do not statically import from #copilot/agent', async () => {
        const { readdir, readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');

        const bridgesDir = join(process.cwd(), 'src', 'copilot', 'bridges');
        const files = await readdir(bridgesDir, { recursive: true });
        const jsFiles = files.filter((/** @type {string} */ f) => f.endsWith('.js'));

        for (const file of jsFiles) {
            const content = await readFile(join(bridgesDir, String(file)), 'utf-8');
            const hasAgentImport = /^\s*import\s+.+\s+from\s+['"]#copilot\/agent(?:\/[^'"]+)?['"]/m.test(content);
            expect(hasAgentImport, `${file} imports from #copilot/agent (layer violation L3→L4)`).toBe(false);
        }
    });
});
