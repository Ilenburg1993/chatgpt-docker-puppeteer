// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    enableCopilotNodeCompileCache,
    resetCopilotNodeCompileCacheHealthForTest,
    withCopilotNodeCompileCacheEnv,
} from '../../../../src/copilot/infra/runtime/node-compile-cache.js';

describe('infra/runtime/node-compile-cache', () => {
    it('respeita disable explícito sem tornar a otimização obrigatória', () => {
        resetCopilotNodeCompileCacheHealthForTest();
        const summary = enableCopilotNodeCompileCache({
            ...process.env,
            COPILOT_NODE_COMPILE_CACHE_DISABLED: '1',
        });

        assert.equal(summary.enabled, false);
        assert.equal(summary.attempted, false);
        assert.equal(summary.statusName, 'DISABLED_BY_ENV');
        assert.equal(summary.error, null);
    });

    it('propaga diretório/portable a filhos sem mutar o objeto de entrada', () => {
        const env = {
            PATH: process.env.PATH,
            COPILOT_NODE_COMPILE_CACHE_DIR: '/tmp/copilot-test-compile-cache',
            COPILOT_NODE_COMPILE_CACHE_PORTABLE: 'true',
        };
        const child = withCopilotNodeCompileCacheEnv(env);

        assert.notEqual(child, env);
        assert.equal(env.NODE_COMPILE_CACHE, undefined);
        assert.equal(child.NODE_COMPILE_CACHE, '/tmp/copilot-test-compile-cache');
        assert.equal(child.NODE_COMPILE_CACHE_PORTABLE, '1');
    });

    it('não injeta cache em filhos quando a otimização foi desabilitada', () => {
        const env = {
            COPILOT_NODE_COMPILE_CACHE_DISABLED: '1',
        };
        assert.equal(withCopilotNodeCompileCacheEnv(env), env);
    });
});
