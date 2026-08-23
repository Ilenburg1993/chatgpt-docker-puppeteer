// @ts-check
/**
 * FG-3 — Testes de contrato entre módulos copilot.
 *
 * Valida que:
 *
 * 1. tools/index.js exporta as ferramentas esperadas (allTools, buildTool, withSkipPermission)
 * 2. contratos transversais saem apenas por owners semânticos exatos; Core não existe
 * 3. bridges/ não importa diretamente de agent/ (violação de camada L3→L4)
 */
import { describe, expect, it, vi } from 'vitest';

// ─── Mocks genéricos para dependências pesadas ──────────────────────────

vi.mock('@github/copilot-sdk', () => ({
    SYSTEM_MESSAGE_SECTIONS: Object.freeze({ identity: 'identity' }),
    SYSTEM_PROMPT_SECTIONS: Object.freeze({ identity: 'identity' }),
    CopilotClient: vi.fn(),
    defineTool: vi.fn((/** @type {Record<string, unknown>} */ definition) => definition),
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
        const barrel = await import('#copilot/tools');
        expect(barrel.allTools, 'missing allTools').toBeDefined();
        expect(barrel.buildTool, 'missing buildTool').toBeDefined();
        expect(barrel.withSkipPermission, 'missing withSkipPermission').toBeDefined();
    });

    it('allTools is an array', async () => {
        const barrel = await import('#copilot/tools');
        expect(Array.isArray(barrel.allTools)).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. semantic owner contracts; no horizontal Core facade
// ═════════════════════════════════════════════════════════════════════════════

describe('FG-3 — semantic owner contracts', () => {
    it('exports resilience and process lifecycle from exact semantic owners', async () => {
        const [resilience, processRuntime] = await Promise.all([
            import('#copilot/infra/public/concurrency/resilience'),
            import('#copilot/boot/process-runtime'),
        ]);
        for (const name of ['OperationTimeoutError', 'sleep', 'withRetry', 'withTimeout']) {
            expect(
                /** @type {Record<string, unknown>} */ (resilience)[name],
                `missing resilience: ${name}`,
            ).toBeDefined();
        }
        for (const name of [
            'PROCESS_SHUTDOWN_PHASE',
            'registerApplicationShutdownHandler',
            'runApplicationShutdown',
            'isApplicationShuttingDown',
            'listApplicationShutdownHandlers',
            'listActiveApplicationTimers',
        ]) {
            expect(
                /** @type {Record<string, unknown>} */ (processRuntime)[name],
                `missing process runtime: ${name}`,
            ).toBeDefined();
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2.1. sdk event seam contract
// ═════════════════════════════════════════════════════════════════════════════

describe('FG-3 — sdk event seam contract', () => {
    it('events/sdk-events exporta listeners e normalizers leves usados por handlers', async () => {
        const barrel = await import('#copilot/events/sdk-events');
        const expected = [
            'SESSION_EVENTS',
            'ALL_EVENT_TYPES',
            'getSessionCapabilities',
            'normalizeElicitationCompletedEvent',
            'normalizeElicitationPendingEvent',
            'normalizeModeChangedEvent',
            'normalizeModelChangedEvent',
            'normalizePermissionCompletedEvent',
            'normalizePermissionRequestedEvent',
            'normalizePlanChangedEvent',
            'normalizeToolsUpdatedEvent',
            'normalizeUserInputCompletedEvent',
            'normalizeUserInputRequestedEvent',
            'onAllSessionEvents',
            'onSessionEvent',
            'onSessionEvents',
        ];
        for (const name of expected) {
            expect(/** @type {Record<string, unknown>} */ (barrel)[name], `missing: ${name}`).toBeDefined();
        }
    });

    it('events/sdk-events não importa o barrel raiz pesado do SDK', async () => {
        const { readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const src = await readFile(join(process.cwd(), 'src', 'copilot', 'events', 'sdk-events.js'), 'utf-8');
        expect(src).not.toMatch(/from\s+['"]#copilot\/sdk['"]/);
        expect(src).toContain("from '#copilot/sdk/session'");
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
