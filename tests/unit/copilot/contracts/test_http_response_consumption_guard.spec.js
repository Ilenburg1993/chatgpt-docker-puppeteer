// @ts-check

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';

import { checkHttpResponseConsumption } from '../../../../scripts/check-copilot-http-response-consumption.mjs';

/** @type {string[]} */
const tempRoots = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** @param {Record<string, string>} files */
async function createFixture(files) {
    const root = await mkdtemp(path.join(tmpdir(), 'copilot-http-response-guard-'));
    tempRoots.push(root);
    for (const [name, source] of Object.entries(files)) {
        const file = path.join(root, name);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, source);
    }
    return root;
}

describe('HTTP response consumption guard', () => {
    it('keeps the current src/copilot tree free of direct inbound consumers', () => {
        assert.deepEqual(checkHttpResponseConsumption(), []);
    });

    it('detects direct fetch bodies, aliases and Promise.all response bindings', async () => {
        const root = await createFixture({
            'direct.js': `
                const response = await fetch('https://example.test');
                await response.json();
                const alias = response;
                await alias.text();
                const [modelsResponse] = await Promise.all([fetchImpl('/models')]);
                await modelsResponse.arrayBuffer();
                await response['blob']();
            `,
        });

        const findings = checkHttpResponseConsumption({ root, target: root, allowedFiles: [] });
        assert.deepEqual(
            findings.map((finding) => finding.method),
            ['json', 'text', 'arrayBuffer', 'blob'],
        );
    });

    it('ignores Express output and bounded facade calls', async () => {
        const root = await createFixture({
            'safe.js': `
                res.status(200).json({ ok: true });
                return readBoundedResponseJson(await fetch('/models'), { maxBytes: 1024 });
            `,
        });

        assert.deepEqual(checkHttpResponseConsumption({ root, target: root, allowedFiles: [] }), []);
    });
});
