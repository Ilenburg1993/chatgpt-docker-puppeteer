// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    VSCODE_DEVCONTAINER_EXTENSIONS,
    VSCODE_HOST_ONLY_EXTENSIONS,
    VSCODE_PRUNABLE_EXTENSIONS,
    VSCODE_RECOMMENDED_EXTENSIONS,
    VSCODE_UNWANTED_EXTENSIONS,
    getExtensionProfile,
    planExtensionReconciliation,
} from '../../../config/vscode/extensions.mjs';

describe('VS Code extension reconciliation', () => {
    it('instala core ausente e remove somente resíduos canônicos com prune', () => {
        const missingCore = VSCODE_DEVCONTAINER_EXTENSIONS.at(-1);
        assert.ok(missingCore);
        const prunable = VSCODE_PRUNABLE_EXTENSIONS[0];
        const unwantedAdvisory = VSCODE_UNWANTED_EXTENSIONS.find(
            (extension) => !VSCODE_PRUNABLE_EXTENSIONS.includes(extension),
        );
        const hostOnly = VSCODE_HOST_ONLY_EXTENSIONS[0];
        assert.ok(prunable);
        assert.ok(unwantedAdvisory);
        assert.ok(hostOnly);
        const installed = [
            ...VSCODE_DEVCONTAINER_EXTENSIONS.slice(0, -1).map((extension) => extension.toUpperCase()),
            prunable.toUpperCase(),
            unwantedAdvisory,
            hostOnly,
            'example.personal-extension',
        ];

        const plan = planExtensionReconciliation(installed, { profile: 'core', prune: true });

        assert.deepEqual(plan.install, [missingCore]);
        assert.deepEqual(plan.remove, [prunable, hostOnly]);
        assert.equal(plan.remove.includes(unwantedAdvisory), false);
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
        const prunable = VSCODE_PRUNABLE_EXTENSIONS[0];
        assert.ok(prunable);

        const plan = planExtensionReconciliation([prunable], { profile: 'core' });

        assert.deepEqual(plan.remove, []);
        assert.equal(plan.install.length, VSCODE_DEVCONTAINER_EXTENSIONS.length);
    });

    it('mantém agentes fora do auto-install e preserva Indent Rainbow como recomendação', () => {
        const agents = getExtensionProfile('agents');
        assert.ok(agents.length > 0);
        for (const agent of agents) assert.equal(VSCODE_DEVCONTAINER_EXTENSIONS.includes(agent), false);
        assert.equal(VSCODE_RECOMMENDED_EXTENSIONS.includes('oderwat.indent-rainbow'), true);
        assert.equal(VSCODE_UNWANTED_EXTENSIONS.includes('oderwat.indent-rainbow'), false);
    });

    it('rejeita perfil desconhecido em vez de produzir plano parcial', () => {
        assert.throws(
            () => planExtensionReconciliation([], { profile: 'perfil-inexistente', prune: true }),
            /Unknown VS Code extension profile/u,
        );
    });
});
