// @ts-check

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

const COPILOT_ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

/**
 * @param {string} relPath
 * @returns {string}
 */
function readSrc(relPath) {
    return readFileSync(join(COPILOT_ROOT, relPath), 'utf8');
}

describe('runtime coupling governance', () => {
    it('runtime/index.js é barrel puro e concentra a surface operacional externa ao agent', () => {
        const src = readSrc('runtime/index.js');
        assert.match(src, /from '\.\.\/presentation\/agent\/runtime\/index\.js'/);
        assert.match(src, /from '\.\.\/presentation\/runtime\/controls\.js'/);
        assert.match(src, /from '\.\.\/presentation\/runtime\/dialog\.js'/);
        assert.match(src, /from '\.\.\/presentation\/runtime\/overview\.js'/);
        assert.doesNotMatch(src, /^\s*(?:const|let|function)\s/m);
    });

    it('channel, conversation-hub e terminal frontend usam #copilot/runtime como seam operacional', () => {
        const files = [
            'channel/client-dialog.js',
            'channel/client.js',
            'conversation-hub/call-strategies.js',
            'terminal/frontend/gateways/agent-runtime.js',
        ];

        for (const file of files) {
            const src = readSrc(file);
            assert.match(src, /from '#copilot\/runtime'/, `${file} deve consumir #copilot/runtime`);
            assert.doesNotMatch(
                src,
                /from '#copilot\/agent\/facades'/,
                `${file} não deve importar #copilot/agent/facades diretamente`,
            );
        }
    });

    it('runtime-wiring mantém imports de composição do agent, mas consulta estado pelo seam canônico', () => {
        const src = readSrc('runtime-wiring.js');
        assert.match(src, /from '#copilot\/runtime'/);
        assert.match(src, /getAgentRuntimeControlStateForTarget/);
        assert.doesNotMatch(src, /from '#copilot\/agent\/facades'/);
    });
});
