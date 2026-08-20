// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { registerLspTools } from '../../../src/integration/tools/lsp-tools.mjs';

test('registro das ferramentas LSP também exige opt-in explícito', async () => {
    const previous = process.env['LSP_ENABLED'];
    /** @type {string[]} */
    const names = [];
    const registry = {
        register(/** @type {string} */ name) {
            names.push(name);
        },
    };
    try {
        delete process.env['LSP_ENABLED'];
        await registerLspTools(registry);
        assert.deepEqual(names, []);

        process.env['LSP_ENABLED'] = 'true';
        await registerLspTools(registry);
        assert.deepEqual(names, [
            'lsp_definition',
            'lsp_references',
            'lsp_hover',
            'lsp_document_symbols',
            'lsp_workspace_symbols',
            'lsp_diagnostics',
            'lsp_code_actions',
            'lsp_apply_code_action',
        ]);
    } finally {
        if (previous === undefined) delete process.env['LSP_ENABLED'];
        else process.env['LSP_ENABLED'] = previous;
    }
});
