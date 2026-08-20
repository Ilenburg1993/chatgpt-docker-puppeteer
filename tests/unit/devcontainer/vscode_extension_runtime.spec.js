// @ts-check

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { availableExtensions, readBuiltInExtensions } from '../../../scripts/setup/vscode-extension-runtime.mjs';

describe('VS Code builtin extension discovery', () => {
    it('descobre IDs por publisher e name e ignora manifests inválidos', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-builtins-'));
        try {
            const validDir = path.join(rootDir, 'extensions', 'copilot');
            const invalidDir = path.join(rootDir, 'extensions', 'broken');
            fs.mkdirSync(validDir, { recursive: true });
            fs.mkdirSync(invalidDir, { recursive: true });
            fs.writeFileSync(
                path.join(validDir, 'package.json'),
                JSON.stringify({ publisher: 'GitHub', name: 'copilot-chat' }),
            );
            fs.writeFileSync(path.join(invalidDir, 'package.json'), '{');

            assert.deepEqual(readBuiltInExtensions({ rootDir }), ['GitHub.copilot-chat']);
        } finally {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    it('une extensões instaladas e builtins sem duplicatas ou dependência de caixa', () => {
        assert.deepEqual(
            availableExtensions(['Vue.volar', 'GitHub.Copilot-Chat'], ['github.copilot-chat', 'vscode.git']),
            ['vue.volar', 'github.copilot-chat', 'vscode.git'],
        );
    });
});
