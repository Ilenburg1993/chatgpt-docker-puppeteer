// ORPHAN: source module deleted (sdk-api.js deleted) — skip until reimplemented
// @ts-check
/**
 * tests/unit/copilot/test_permission_controller.spec.js
 *
 * G2-TEST-04/05: Testes para PermissionController.
 *
 * - G2-TEST-04: modo configurável via env (G2-DX-12/13)
 * - G2-TEST-05: setMode() emite log e notifica callback
 */

import assert from 'node:assert/strict';
import { afterEach, beforeAll, describe, it } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: análise estrutural
// ─────────────────────────────────────────────────────────────────────────────

describe.skip('PermissionController › análise estrutural (G2-DX-12/13/15)', async () => {
    /** @type {string} */
    let src = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        src = await readFile(resolve(dir, '../../../src/copilot/agent/permission-controller.js'), 'utf8');
    });

    it('modo padrão deve ser configurável via AGENT_PERMISSION_MODE', () => {
        assert.ok(src.includes('AGENT_PERMISSION_MODE'), "deve usar process.env['AGENT_PERMISSION_MODE'] como default");
    });

    it('lista denyShell deve ser configurável via AGENT_DENY_SHELL_TOOLS', () => {
        assert.ok(
            src.includes('AGENT_DENY_SHELL_TOOLS'),
            "deve usar process.env['AGENT_DENY_SHELL_TOOLS'] para lista shell deny",
        );
    });

    it('setMode() deve logar que a mudança é imediata', () => {
        assert.ok(
            src.includes('imediatamente') || src.includes('imediata'),
            'setMode() deve documentar que a mudança é aplicada imediatamente',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: comportamento de PermissionController
// ─────────────────────────────────────────────────────────────────────────────

describe('PermissionController › comportamento (G2-TEST-04/05)', async () => {
    /** @type {import('#copilot/testing/hooks/permission-controller').PermissionController} */
    let ctrl;
    /** @type {typeof import('#copilot/testing/hooks/permission-controller')} */
    let mod;

    beforeAll(async () => {
        mod = await import('#copilot/testing/hooks/permission-controller');
        const { PermissionController } = mod;
        ctrl = new PermissionController();
    });

    afterEach(() => {
        // Restaurar modo padrão
        ctrl.setMode('approve_all');
    });

    it('getMode() deve retornar o modo atual', () => {
        const mode = ctrl.getMode();
        assert.ok(typeof mode === 'string', 'getMode() deve retornar string');
    });

    it('setMode("audit_only") deve alterar o modo para audit_only', () => {
        ctrl.setMode('audit_only');
        assert.equal(ctrl.getMode(), 'audit_only');
    });

    it('handler deve ser um objeto após setMode("approve_all")', () => {
        ctrl.setMode('approve_all');
        assert.ok(ctrl.handler !== null && ctrl.handler !== undefined, 'handler deve ser definido');
        assert.ok(
            typeof ctrl.handler === 'object' || typeof ctrl.handler === 'function',
            'handler deve ser objeto ou função',
        );
    });

    it('setMode() deve invocar callback onModeChanged fornecido no construtor', () => {
        /** @type {string | null} */
        let notified = null;
        const { PermissionController } = mod;
        const c2 = new PermissionController({
            onModeChanged: (
                /** @type {Parameters<
    InstanceType<
        typeof import('../../../src/copilot/hooks/permission-controller.js').PermissionController
    >['setMode']
>[0]} */ m,
            ) => {
                notified = m;
            },
        });
        c2.setMode('audit_only');
        assert.equal(notified, 'audit_only', 'callback deve ser invocado com o novo modo');
    });

    it('setMode() não deve alterar o modo se o modo é inválido', () => {
        const before = ctrl.getMode();
        ctrl.setMode(/** @type {any} */ ('modo_invalido'));
        assert.equal(ctrl.getMode(), before, 'modo deve permanecer inalterado com input inválido');
    });

    it('setMode("selective") deve retornar handler configurado', () => {
        ctrl.setMode('selective', { denyShell: true });
        assert.equal(ctrl.getMode(), 'selective');
        assert.ok(ctrl.handler, 'handler deve ser definido em modo selective');
    });

    it('handler entregue ao SDK é estável e passa a usar a policy atual', async () => {
        const sdkHandler = ctrl.handler;
        ctrl.setMode('approve_all');
        assert.equal(
            (await sdkHandler(/** @type {any} */ ({ kind: 'shell' }), { sessionId: 's1' })).kind,
            'approve-once',
        );

        ctrl.setMode('selective', { denyShell: true });
        assert.equal((await sdkHandler(/** @type {any} */ ({ kind: 'shell' }), { sessionId: 's1' })).kind, 'reject');
        assert.equal(ctrl.handler, sdkHandler, 'referência do handler deve permanecer estável para o SDK');
    });

    it('helper configurável preserva approve_all por default e aceita override por AGENT_PERMISSION_MODE', async () => {
        const previous = process.env['AGENT_PERMISSION_MODE'];
        try {
            delete process.env['AGENT_PERMISSION_MODE'];
            const defaultHandler = mod.createConfiguredPermissionHandler();
            assert.equal(
                (await defaultHandler(/** @type {any} */ ({ kind: 'shell' }), { sessionId: 'default' })).kind,
                'approve-once',
            );

            process.env['AGENT_PERMISSION_MODE'] = 'selective';
            const selectiveHandler = mod.createConfiguredPermissionHandler();
            assert.equal(
                (await selectiveHandler(/** @type {any} */ ({ kind: 'shell' }), { sessionId: 'selective' })).kind,
                'reject',
            );
        } finally {
            if (previous === undefined) delete process.env['AGENT_PERMISSION_MODE'];
            else process.env['AGENT_PERMISSION_MODE'] = previous;
        }
    });
});
