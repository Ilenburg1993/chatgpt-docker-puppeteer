// @ts-check
/**
 * @file Faixa 46 — Business logic: code-tools, permission-tools, rate-limiter-state
 *
 *   Cobre módulos verdadeiramente sem cobertura:
 *
 *   - tools/code-tools.js (143L) — lint_check, run_tests, typecheck tools
 *   - tools/permission-tools.js (165L) — permission_mode_get, permission_mode_set
 *   - terminal/rate-limiter-state.js (34L) — DI bridge pattern
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. terminal/rate-limiter-state.js — DI bridge (sem mocks — pura lógica)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F46 — rate-limiter-state DI bridge', () => {
    /** @type {typeof import('#copilot/terminal/state/repl-runtime')} */
    let rlMod;

    beforeAll(async () => {
        rlMod = await import('#copilot/terminal/state/repl-runtime');
    });

    beforeEach(() => {
        rlMod.resetRateLimiterStateForTests();
    });

    it('clearRateLimiters() é no-op antes de register', () => {
        expect(() => rlMod.clearRateLimiters()).not.toThrow();
    });

    it('registerClearRateLimiters + clearRateLimiters chama a fn registrada', () => {
        const fn = vi.fn();
        rlMod.registerClearRateLimiters(fn);
        rlMod.clearRateLimiters();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('registrar nova fn sobrescreve a anterior', () => {
        const fn1 = vi.fn();
        const fn2 = vi.fn();
        rlMod.registerClearRateLimiters(fn1);
        rlMod.registerClearRateLimiters(fn2);
        rlMod.clearRateLimiters();
        expect(fn1).not.toHaveBeenCalled();
        expect(fn2).toHaveBeenCalledOnce();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. tools/permission-tools.js — import real (módulo carrega sem efeitos colaterais)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F46 — permission-tools', () => {
    /** @type {typeof import('#copilot/tools')} */
    let mod;

    beforeAll(async () => {
        mod = await import('#copilot/tools');
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
        mod.setPermissionAgent(/** @type {any} */ (fakeAgent), { force: true });
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
        mod.setPermissionAgent(/** @type {any} */ (fakeAgent), { force: true });
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
        mod.setPermissionAgent(/** @type {any} */ (fakeAgent), { force: true });
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
    /** @type {typeof import('#copilot/tools')} */
    let mod;

    beforeAll(async () => {
        mod = await import('#copilot/tools');
    });

    it('codeTools exporta array combinado com tools read-only e mutável', () => {
        expect(Array.isArray(mod.codeTools)).toBe(true);
        expect(mod.codeTools).toHaveLength(5);
        expect(mod.codeReadTools).toHaveLength(4);
        expect(mod.codeWriteTools).toHaveLength(1);
    });

    it('contém lint_check, lint_fix, quality_gate, run_tests e typecheck', () => {
        const names = mod.codeTools.map((/** @type {any} */ t) => t.name);
        expect(names).toContain('lint_check');
        expect(names).toContain('lint_fix');
        expect(names).toContain('quality_gate');
        expect(names).toContain('run_tests');
        expect(names).toContain('typecheck');
    });

    it('lint_check handler retorna { success, output } sem aceitar fix', async () => {
        const lintTool = /** @type {any} */ (mod.codeTools.find((/** @type {any} */ t) => t.name === 'lint_check'));
        const blocked = await lintTool.handler({ fix: true, path: 'src/copilot/audit/ring-buffer.js' });
        expect(blocked.success).toBe(false);
        expect(blocked.blockedReason).toBe('mutating_parameter_on_readonly_tool');

        const result = await lintTool.handler({ path: 'src/copilot/audit/ring-buffer.js' });
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('output');
    }, 30_000);

    it('quality_gate rejeita gate não allowlisted em chamada direta defensiva', async () => {
        const qualityGate = /** @type {any} */ (
            mod.codeTools.find((/** @type {any} */ t) => t.name === 'quality_gate')
        );
        const result = await qualityGate.handler({ gate: 'npm-run-anything', scope: 'src/copilot' });
        expect(result).toMatchObject({
            success: false,
            ok: false,
            blockedReason: 'quality_gate_not_allowlisted',
        });
    });

    it('apenas codeReadTools têm skipPermission true; lint_fix requer aprovação', () => {
        for (const tool of mod.codeReadTools) {
            expect(/** @type {any} */ (tool).skipPermission).toBe(true);
        }
        const lintFix = /** @type {any} */ (mod.codeWriteTools.find((/** @type {any} */ t) => t.name === 'lint_fix'));
        expect(lintFix.skipPermission).not.toBe(true);
    });
});
