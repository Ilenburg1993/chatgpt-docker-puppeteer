// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    VSCODE_DEVCONTAINER_EXTENSIONS,
    VSCODE_HOST_ONLY_EXTENSIONS,
    VSCODE_UNWANTED_EXTENSIONS,
    planExtensionReconciliation,
} from '../../../config/vscode/extensions.mjs';

describe('VS Code extension reconciliation', () => {
    it('instala core ausente e remove somente resíduos canônicos com prune', () => {
        const missingCore = VSCODE_DEVCONTAINER_EXTENSIONS.at(-1);
        assert.ok(missingCore);
        const unwanted = VSCODE_UNWANTED_EXTENSIONS[0];
        const hostOnly = VSCODE_HOST_ONLY_EXTENSIONS[0];
        assert.ok(unwanted);
        assert.ok(hostOnly);
        const installed = [
            ...VSCODE_DEVCONTAINER_EXTENSIONS.slice(0, -1).map((extension) => extension.toUpperCase()),
            unwanted.toUpperCase(),
            hostOnly,
            'example.personal-extension',
        ];

        const plan = planExtensionReconciliation(installed, { profile: 'core', prune: true });

        assert.deepEqual(plan.install, [missingCore]);
        assert.deepEqual(plan.remove, [unwanted, hostOnly]);
        assert.equal(plan.remove.includes('example.personal-extension'), false);
    });

    it('aceita builtin como capacidade disponível sem tentar instalá-lo ou removê-lo', () => {
        const builtIn = VSCODE_DEVCONTAINER_EXTENSIONS[0];
        assert.ok(builtIn);

        const plan = planExtensionReconciliation([], {
            profile: 'core',
            prune: true,
            availableExtensions: [builtIn.toUpperCase()],
        });

        assert.equal(plan.install.includes(builtIn), false);
        assert.equal(plan.remove.includes(builtIn), false);
    });

    it('não remove extensões quando prune não foi solicitado', () => {
        const unwanted = VSCODE_UNWANTED_EXTENSIONS[0];
        assert.ok(unwanted);

        const plan = planExtensionReconciliation([unwanted], { profile: 'core' });

        assert.deepEqual(plan.remove, []);
        assert.equal(plan.install.length, VSCODE_DEVCONTAINER_EXTENSIONS.length);
    });

    it('rejeita perfil desconhecido em vez de produzir plano parcial', () => {
        assert.throws(
            () => planExtensionReconciliation([], { profile: 'perfil-inexistente', prune: true }),
            /Unknown VS Code extension profile/u,
        );
    });
});
