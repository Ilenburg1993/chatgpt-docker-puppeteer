// @ts-check

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'vitest';

const COPILOT_ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const TERMINAL_FRONTEND_ROOT = join(COPILOT_ROOT, 'terminal/frontend');
const SDK_ROUTES_ROOT = join(COPILOT_ROOT, 'server/routes/sdk');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFilesRecursive(dir) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const st = statSync(abs);
        if (st.isDirectory()) {
            files.push(...listJsFilesRecursive(abs));
        } else if (st.isFile() && entry.endsWith('.js')) {
            files.push(abs);
        }
    }
    return files;
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function readImportSpecifiers(filePath) {
    const src = readFileSync(filePath, 'utf8');
    const specs = [];
    for (const line of src.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('//') || t.startsWith('*')) continue;
        const m = t.match(/^import\s+.+\s+from\s+['"]([^'"]+)['"]/);
        if (m?.[1]) specs.push(m[1]);
    }
    return specs;
}

describe('canonical flow governance', () => {
    it('terminal/frontend só acessa #copilot/channel através do gateway dialog.js', () => {
        const files = listJsFilesRecursive(TERMINAL_FRONTEND_ROOT);
        const offenders = [];

        for (const abs of files) {
            const rel = relative(TERMINAL_FRONTEND_ROOT, abs).replace(/\\/g, '/');
            const specs = readImportSpecifiers(abs);
            if (!specs.includes('#copilot/channel')) continue;

            if (rel !== 'gateways/dialog.js') {
                offenders.push(rel);
            }
        }

        assert.deepEqual(
            offenders,
            [],
            `Imports diretos de #copilot/channel fora do gateway canônico detectados: ${offenders.join(', ')}`,
        );
    });

    it('server/routes/sdk mantém composição por deps sem imports de domínio proibidos', () => {
        const files = listJsFilesRecursive(SDK_ROUTES_ROOT);
        const forbiddenRoots = [
            '#copilot/sdk',
            '#copilot/agent',
            '#copilot/tools',
            '#copilot/hooks',
            '#copilot/bridges',
            '#copilot/config',
            '#copilot/presentation',
        ];

        const offenders = [];

        for (const abs of files) {
            const rel = relative(SDK_ROUTES_ROOT, abs).replace(/\\/g, '/');
            if (rel === 'deps.js') continue;

            for (const spec of readImportSpecifiers(abs)) {
                const violated = forbiddenRoots.some((root) => spec === root || spec.startsWith(`${root}/`));
                if (violated) {
                    offenders.push(`${rel} -> ${spec}`);
                }
            }
        }

        assert.deepEqual(offenders, [], `Bypass de composição em rotas SDK detectado:\n${offenders.join('\n')}`);
    });
});
