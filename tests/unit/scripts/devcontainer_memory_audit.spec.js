// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyProcess, humanBytes, parsePsi } from '../../../scripts/analysis/devcontainer-memory-audit.mjs';

describe('devcontainer memory audit helpers', () => {
    it('separa o language server TS7 nativo da infraestrutura genérica do VS Code', () => {
        assert.equal(
            classifyProcess(
                '/home/node/.vscode-server/extensions/typescriptteam.native-preview-0.20260708.2-linux-x64/lib/tsc --lsp --stdio',
                'tsc',
                '/workspaces/chatgpt-docker-puppeteer',
            ),
            'typescript:tsgo-lsp',
        );
        assert.equal(
            classifyProcess(
                '/vscode/vscode-server/bin/linux-x64/node out/bootstrap-fork --type=extensionHost',
                'MainThread',
                '/workspaces/chatgpt-docker-puppeteer',
            ),
            'vscode:extension-host',
        );
    });

    it('classifica agentes pesados de forma independente', () => {
        assert.equal(classifyProcess('/cache/cloud-code/cloudcode_cli duet', 'cloudcode_cli', null), 'agent:gemini');
        assert.equal(classifyProcess('/extensions/kilocode.kilo-code/bin/kilo serve', 'kilo', null), 'agent:kilo');
        assert.equal(
            classifyProcess('/extensions/openai.chatgpt/bin/codex app-server', 'codex', null),
            'agent:openai-codex',
        );
    });

    it('parseia PSI e formata tamanhos sem esconder ausência de dado', () => {
        assert.deepEqual(
            parsePsi(
                'some avg10=0.10 avg60=0.20 avg300=0.30 total=42\nfull avg10=0.00 avg60=0.01 avg300=0.02 total=7\n',
            ),
            {
                some: { avg10: 0.1, avg60: 0.2, avg300: 0.3, total: 42 },
                full: { avg10: 0, avg60: 0.01, avg300: 0.02, total: 7 },
            },
        );
        assert.equal(humanBytes(1024 * 1024), '1.0 MiB');
        assert.equal(humanBytes(null), '-');
    });
});
