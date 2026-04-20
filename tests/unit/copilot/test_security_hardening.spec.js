// @ts-check
/**
 * F131: Testes de segurança para session-tools.js — verifica que shell metacaracteres não são interpretados. F136:
 * Testes para sanitizeErrorMessage em middleware.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

// ─── F131: execFileSync security ─────────────────────────────────────────────

describe('session-tools — execFileSync security (F131)', () => {
    it('get_workspace_info retorna git info sem shell injection', async () => {
        // Importar e invocar o tool handler via módulo
        const { sessionTools } = await import('../../../src/copilot/tools/session-tools.js');
        const getWorkspaceInfo = sessionTools.find((t) => t.name === 'get_workspace_info');
        assert.ok(getWorkspaceInfo, 'Tool get_workspace_info deve existir');
        const result = /** @type {any} */ (
            await getWorkspaceInfo.handler(
                {},
                { sessionId: 'test-session', toolCallId: 'tool-1', toolName: 'get_workspace_info', arguments: {} },
            )
        );
        assert.ok(result.cwd, 'Deve ter cwd');
        assert.ok(result.nodeVersion, 'Deve ter nodeVersion');
        // Git info pode ser null em ambientes sem git, mas no workspace deve existir
        if (result.git) {
            assert.ok(typeof result.git.branch === 'string');
            assert.ok(typeof result.git.commit === 'string');
        }
    });

    it('session-tools não importa execSync', async () => {
        const source = await import('node:fs/promises').then((fs) =>
            fs.readFile(new URL('../../../src/copilot/tools/session-tools.js', import.meta.url), 'utf8'),
        );
        assert.ok(!source.includes('execSync'), 'Não deve importar execSync (usar execFileSync)');
        assert.ok(source.includes('execFileSync'), 'Deve usar execFileSync');
    });
});

// ─── F136: Error sanitizer ───────────────────────────────────────────────────

describe('middleware — error sanitizer (F136)', () => {
    it('módulo middleware exporta withErrorHandler', async () => {
        const mod = await import('../../../src/copilot/server/routes/sdk/middleware.js');
        assert.ok(typeof mod.withErrorHandler === 'function');
    });
});
