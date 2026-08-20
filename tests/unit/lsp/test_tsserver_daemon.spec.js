// @ts-check
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { TsserverDaemon } from '../../../src/integration/lsp/tsserver-daemon.mjs';

describe('TsserverDaemon', () => {
    it('resolves definitions/references/hover for a JS file', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-daemon-'));
        try {
            await fs.writeFile(
                path.join(rootDir, 'jsconfig.json'),
                JSON.stringify({
                    compilerOptions: { checkJs: true, allowJs: true, module: 'NodeNext', moduleResolution: 'NodeNext' },
                    include: ['**/*.js'],
                }),
                'utf8',
            );
            const filePath = path.join(rootDir, 'sample.js');
            await fs.writeFile(filePath, 'const value = 1;\nconsole.log(value);\n', 'utf8');

            const daemon = new TsserverDaemon({ rootDir, timeoutMs: 10000 });
            await daemon.start();

            const definitions = await daemon.execute('definition', {
                filePath,
                line: 2,
                character: 13,
            });
            assert.ok(Array.isArray(definitions));
            assert.ok(definitions.length >= 1);

            const references = await daemon.execute('references', {
                filePath,
                line: 2,
                character: 13,
            });
            assert.ok(Array.isArray(references));
            assert.ok(references.length >= 1);

            const hover = /** @type {any} */ (
                await daemon.execute('hover', {
                    filePath,
                    line: 2,
                    character: 13,
                })
            );
            assert.ok(hover);
            assert.ok(typeof hover.display === 'string');

            // Stale editor/LSP positions must clamp to a valid source offset instead of triggering a TypeScript
            // `Debug Failure` assertion when the line or character raced ahead of the current file contents.
            const staleHover = await daemon.execute('hover', {
                filePath,
                line: 999,
                character: 999,
            });
            assert.ok(staleHover === null || typeof staleHover === 'object');

            await daemon.stop();
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    it('evicts the heavy language-service cache after the configured idle window', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-daemon-'));
        try {
            await fs.writeFile(path.join(rootDir, 'jsconfig.json'), JSON.stringify({ include: ['**/*.js'] }), 'utf8');
            const filePath = path.join(rootDir, 'sample.js');
            await fs.writeFile(filePath, 'const answer = 42;\nanswer;\n', 'utf8');

            const daemon = new TsserverDaemon({ rootDir, timeoutMs: 10_000, idleTtlMs: 10 });
            const first = await daemon.execute('hover', { filePath, line: 2, character: 2 });
            assert.ok(first);
            await new Promise((resolve) => setTimeout(resolve, 30));

            // A second operation must transparently recreate the evicted service and remain fully functional.
            const second = await daemon.execute('hover', { filePath, line: 2, character: 2 });
            assert.ok(second);
            await daemon.stop();
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    it('provides completion and allows updating files', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-daemon-'));
        try {
            await fs.writeFile(
                path.join(rootDir, 'jsconfig.json'),
                JSON.stringify({
                    compilerOptions: { checkJs: true, allowJs: true, module: 'NodeNext', moduleResolution: 'NodeNext' },
                    include: ['**/*.js'],
                }),
                'utf8',
            );
            const filePath = path.join(rootDir, 'auto.js');
            await fs.writeFile(filePath, 'function foo() { return 42; }\nfoo();\n', 'utf8');

            const daemon = new TsserverDaemon({ rootDir, timeoutMs: 10000 });
            await daemon.start();

            const comps = await daemon.execute('completion', {
                filePath,
                line: 2,
                character: 1,
            });
            assert.ok(Array.isArray(comps));
            assert.ok(/** @type {{ name?: string }[]} */ (comps).some((c) => c.name === 'foo'));

            const update = await daemon.execute('updateFile', {
                filePath,
                content: 'const x = 123;\n',
            });
            assert.deepStrictEqual(update, { updated: true });
            const newContent = await fs.readFile(filePath, 'utf8');
            assert.strictEqual(newContent, 'const x = 123;\n');

            await daemon.stop();
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    it('supports preview/apply code action edits with mutation guards', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-daemon-'));
        const previousMutationsEnabled = process.env['LSP_MUTATIONS_ENABLED'];

        try {
            await fs.writeFile(path.join(rootDir, 'jsconfig.json'), JSON.stringify({ include: ['**/*.js'] }), 'utf8');
            const filePath = path.join(rootDir, 'editable.js');
            await fs.writeFile(filePath, 'const n = 1;\n', 'utf8');

            const daemon = new TsserverDaemon({ rootDir, timeoutMs: 10000 });
            await daemon.start();

            const action = {
                title: 'Replace const',
                edits: [
                    {
                        filePath,
                        start: 0,
                        length: 5,
                        newText: 'let  ',
                    },
                ],
            };

            const preview = /** @type {any} */ (
                await daemon.execute('apply_code_action', {
                    mode: 'preview',
                    action,
                })
            );
            assert.strictEqual(preview.mode, 'preview');
            assert.strictEqual(preview.totalEdits, 1);

            process.env['LSP_MUTATIONS_ENABLED'] = 'false';
            await assert.rejects(
                async () => daemon.execute('apply_code_action', { mode: 'apply', action, confirmationToken: 'token' }),
                /LSP_MUTATIONS_DISABLED/,
            );

            process.env['LSP_MUTATIONS_ENABLED'] = 'true';
            const applied = /** @type {any} */ (
                await daemon.execute('apply_code_action', {
                    mode: 'apply',
                    action,
                    confirmationToken: 'ok-token',
                })
            );
            assert.strictEqual(applied.mode, 'apply');
            const text = await fs.readFile(filePath, 'utf8');
            assert.ok(text.startsWith('let  '));

            await daemon.stop();
        } finally {
            if (previousMutationsEnabled === undefined) {
                delete process.env['LSP_MUTATIONS_ENABLED'];
            } else {
                process.env['LSP_MUTATIONS_ENABLED'] = previousMutationsEnabled;
            }
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });
});
