// @ts-check
import { describe, it } from 'node:test';
/**
 * @file Faixa 46 — Business logic: code-tools, permission-tools, rate-limiter-state
 *
 *   Cobre módulos verdadeiramente sem cobertura:
 *
 *   - tools/code-tools.js (143L) — lint_check, run_tests, typecheck tools
 *   - tools/permission-tools.js (165L) — permission_mode_get, permission_mode_set
 *   - terminal/rate-limiter-state.js (34L) — DI bridge pattern
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. terminal/rate-limiter-state.js — DI bridge (sem mocks — pura lógica)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F46 — rate-limiter-state DI bridge', () => {
    it('clearRateLimiters() é no-op antes de register', async () => {
        vi.resetModules();
        const { clearRateLimiters } = await import('#copilot/terminal/rate-limiter-state');
        expect(() => clearRateLimiters()).not.toThrow();
    });

    it('registerClearRateLimiters + clearRateLimiters chama a fn registrada', async () => {
        vi.resetModules();
        const { registerClearRateLimiters, clearRateLimiters } = await import('#copilot/terminal/rate-limiter-state');
        const fn = vi.fn();
        registerClearRateLimiters(fn);
        clearRateLimiters();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('registrar nova fn sobrescreve a anterior', async () => {
        vi.resetModules();
        const { registerClearRateLimiters, clearRateLimiters } = await import('#copilot/terminal/rate-limiter-state');
        const fn1 = vi.fn();
        const fn2 = vi.fn();
        registerClearRateLimiters(fn1);
        registerClearRateLimiters(fn2);
        clearRateLimiters();
        expect(fn1).not.toHaveBeenCalled();
        expect(fn2).toHaveBeenCalledOnce();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. tools/permission-tools.js — import real (módulo carrega sem efeitos colaterais)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F46 — permission-tools', () => {
    /** @type {typeof import('#copilot/tools/permission-tools')} */
    let mod;

    beforeAll(async () => {
        mod = await import('#copilot/tools/permission-tools');
    });

    it('permissionTools exporta array com 2 tools', () => {
        expect(Array.isArray(mod.permissionTools)).toBe(true);
        expect(mod.permissionTools).toHaveLength(2);
    });

    it('tem permission_mode_get com name e handler', () => {
        const getTool = mod.permissionTools.find((/** @type {any} */ t) => t.name === 'permission_mode_get');
        expect(getTool).toBeDefined();
        expect(typeof (/** @type {any} */ (getTool)?.handler)).toBe('function');
    });

    it('tem permission_mode_set com name e handler', () => {
        const setTool = mod.permissionTools.find((/** @type {any} */ t) => t.name === 'permission_mode_set');
        expect(setTool).toBeDefined();
        expect(typeof (/** @type {any} */ (setTool)?.handler)).toBe('function');
    });

    it('setPermissionAgent + handler get retorna modo do agente', async () => {
        const fakeAgent = { getPermissionMode: vi.fn(() => 'approve_all'), setPermissionMode: vi.fn() };
        mod.setPermissionAgent(/** @type {any} */ (fakeAgent));
        const getTool = /** @type {any} */ (
            mod.permissionTools.find((/** @type {any} */ t) => t.name === 'permission_mode_get')
        );
        const result = await getTool.handler({});
        expect(result).toEqual({ mode: 'approve_all' });
    });

    it('handler set altera modo e retorna before/after/ok', async () => {
        let currentMode = 'approve_all';
        const fakeAgent = {
            getPermissionMode: vi.fn(() => currentMode),
            setPermissionMode: vi.fn((/** @type {string} */ mode) => {
                currentMode = mode;
            }),
        };
        mod.setPermissionAgent(/** @type {any} */ (fakeAgent));
        const setTool = /** @type {any} */ (
            mod.permissionTools.find((/** @type {any} */ t) => t.name === 'permission_mode_set')
        );
        const result = await setTool.handler({ mode: 'audit_only' });
        expect(result.ok).toBe(true);
        expect(result.before).toBe('approve_all');
        expect(result.after).toBe('audit_only');
    });

    it('handler set com selective inclui nota sobre granular', async () => {
        const fakeAgent = {
            getPermissionMode: vi.fn().mockReturnValueOnce('approve_all').mockReturnValueOnce('selective'),
            setPermissionMode: vi.fn(),
        };
        mod.setPermissionAgent(/** @type {any} */ (fakeAgent));
        const setTool = /** @type {any} */ (
            mod.permissionTools.find((/** @type {any} */ t) => t.name === 'permission_mode_set')
        );
        const result = await setTool.handler({ mode: 'selective', allowTools: ['read_file'], denyShell: true });
        expect(result.note).toContain('seletivo');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. tools/code-tools.js — import real (executa safeExec com child_process real)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F46 — code-tools', () => {
    /** @type {typeof import('#copilot/tools/code-tools')} */
    let mod;

    beforeAll(async () => {
        mod = await import('#copilot/tools/code-tools');
    });

    it('codeTools exporta array com 3 tools', () => {
        expect(Array.isArray(mod.codeTools)).toBe(true);
        expect(mod.codeTools).toHaveLength(3);
    });

    it('contém lint_check, run_tests e typecheck', () => {
        const names = mod.codeTools.map((/** @type {any} */ t) => t.name);
        expect(names).toContain('lint_check');
        expect(names).toContain('run_tests');
        expect(names).toContain('typecheck');
    });

    it('lint_check handler retorna { success, output }', async () => {
        const lintTool = /** @type {any} */ (mod.codeTools.find((/** @type {any} */ t) => t.name === 'lint_check'));
        const result = await lintTool.handler({ fix: false, path: 'src/copilot/audit/ring-buffer.js' });
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('output');
    }, 30_000);

    it('todas as tools têm skipPermission true (via withSkipPermission)', () => {
        for (const tool of mod.codeTools) {
            expect(/** @type {any} */ (tool).skipPermission).toBe(true);
        }
    });
});
