// @ts-check
/**
 * FI-7 — Contract tests round 2 — Barrel contracts para novos módulos.
 *
 * Valida que os barrels adicionados na Faixa I exportam os símbolos esperados e que nenhum deep import proibido existe
 * nos módulos migrados.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// ─── Mocks genéricos para dependências pesadas ──────────────────────────

vi.mock('@github/copilot-sdk', () => ({
    SYSTEM_PROMPT_SECTIONS: Object.freeze({ identity: 'identity' }),
    CopilotClient: vi.fn(),
    defineTool: vi.fn(() => ({ name: 'mock-tool', description: 'mock', schema: {} })),
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
        const expected = ['DEFAULT_EXCLUDED_TOOLS'];
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
        const expected = ['getToolStats', 'recordToolCall'];
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

// ═════════════════════════════════════════════════════════════════════════════
// 6. deep-import guard — nenhum deep import proibido em src/copilot/
// ═════════════════════════════════════════════════════════════════════════════

describe('FI-7 — deep-import guard (Faixa I enforcement)', () => {
    /** Padrão de deep import proibido (não é alias intencional) */
    const DEEP_IMPORT_RE =
        /#copilot\/(core|config|observability|hooks|audit|conversation-hub|bridges|tools|channel|db|api)\/.+/;

    /** Aliases intencionais permitidos */
    const INTENTIONAL_ALIASES = new Set(['#copilot/config/custom-tools-registry', '#copilot/config/tools-state']);

    /** Arquivos com exceção explícita (usa alias intencional) */
    const ALLOWED_FILES = new Set(['tools/bootstrap.js', 'sdk/models/helpers.js']);

    it('no prohibited deep imports in src/copilot/ JS files', async () => {
        const copilotDir = join(process.cwd(), 'src', 'copilot');
        const allFiles = await readdir(copilotDir, { recursive: true });
        const jsFiles = allFiles.filter(
            (/** @type {string} */ f) => String(f).endsWith('.js') && !String(f).includes('node_modules'),
        );

        const violations = [];

        for (const file of jsFiles) {
            const fileStr = String(file);
            if (ALLOWED_FILES.has(fileStr)) continue;

            const content = await readFile(join(copilotDir, fileStr), 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? '';
                // Pular comentários
                if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
                // Checar deep imports em linhas de import
                const match = line.match(/from\s+['"]([^'"]+)['"]/);
                const importPath = match?.[1];
                if (importPath && DEEP_IMPORT_RE.test(importPath) && !INTENTIONAL_ALIASES.has(importPath)) {
                    violations.push(`${fileStr}:${i + 1} → ${importPath}`);
                }
            }
        }

        expect(violations, `Deep imports proibidos encontrados:\n${violations.join('\n')}`).toHaveLength(0);
    });
});
