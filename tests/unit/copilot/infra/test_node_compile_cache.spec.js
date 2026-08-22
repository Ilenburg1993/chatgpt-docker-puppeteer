// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import {
    activateCopilotNodeCompileCacheProcessOwner,
    enableCopilotNodeCompileCache,
    getCopilotNodeCompileCacheHealth,
    readCopilotNodeCompileCacheConfig,
    withCopilotNodeCompileCacheEnv,
} from '#copilot/infra/internal/platform/node';

import { resetCopilotNodeCompileCacheHealthForTest } from '#copilot/infra/public/testing';

afterEach(() => {
    resetCopilotNodeCompileCacheHealthForTest();
});

describe('infra/platform/node/compile-cache', () => {
    it('respeita disable explícito sem tornar a otimização obrigatória', () => {
        resetCopilotNodeCompileCacheHealthForTest();
        const config = readCopilotNodeCompileCacheConfig({
            ...process.env,
            COPILOT_NODE_COMPILE_CACHE_DISABLED: '1',
        });
        const summary = enableCopilotNodeCompileCache(config);

        assert.equal(summary.enabled, false);
        assert.equal(summary.attempted, false);
        assert.equal(summary.statusName, 'DISABLED_BY_CONFIG');
        assert.equal(getCopilotNodeCompileCacheHealth().config.disabled, true);
        assert.equal(summary.error, null);
    });

    it('propaga diretório/portable a filhos sem mutar o objeto de entrada', () => {
        /** @type {NodeJS.ProcessEnv} */
        const env = {
            PATH: process.env['PATH'],
            COPILOT_NODE_COMPILE_CACHE_DIR: '/tmp/copilot-test-compile-cache',
            COPILOT_NODE_COMPILE_CACHE_PORTABLE: 'true',
        };
        const child = withCopilotNodeCompileCacheEnv(env);

        assert.notEqual(child, env);
        assert.equal(env['NODE_COMPILE_CACHE'], undefined);
        assert.equal(child['NODE_COMPILE_CACHE'], '/tmp/copilot-test-compile-cache');
        assert.equal(child['NODE_COMPILE_CACHE_PORTABLE'], '1');
    });

    it('não injeta cache em filhos quando a otimização foi desabilitada', () => {
        const env = {
            COPILOT_NODE_COMPILE_CACHE_DISABLED: '1',
        };
        assert.equal(withCopilotNodeCompileCacheEnv(env), env);
    });

    it('adota a configuração precoce idêntica sem reativar o cache', () => {
        const config = readCopilotNodeCompileCacheConfig({ COPILOT_NODE_COMPILE_CACHE_DISABLED: '1' });
        enableCopilotNodeCompileCache(config);
        const token = Object.freeze({});
        const deactivate = activateCopilotNodeCompileCacheProcessOwner({
            token,
            processId: 'compile-cache-owner-a',
            config,
        });
        assert.deepEqual(getCopilotNodeCompileCacheHealth().owner, {
            active: true,
            processId: 'compile-cache-owner-a',
            adoption: 'adopted-early',
        });
        deactivate();
        assert.equal(getCopilotNodeCompileCacheHealth().owner.active, false);
    });

    it('recusa split-brain entre bootstrap precoce e ProcessInfraConfig', () => {
        const early = readCopilotNodeCompileCacheConfig({ COPILOT_NODE_COMPILE_CACHE_DISABLED: '1' });
        const processConfig = readCopilotNodeCompileCacheConfig({
            COPILOT_NODE_COMPILE_CACHE_DISABLED: '0',
            COPILOT_NODE_COMPILE_CACHE_DIR: '/tmp/another-compile-cache',
        });
        enableCopilotNodeCompileCache(early);
        assert.throws(
            () =>
                activateCopilotNodeCompileCacheProcessOwner({
                    token: Object.freeze({}),
                    processId: 'compile-cache-owner-mismatch',
                    config: processConfig,
                }),
            /** @param {unknown} error */ (error) =>
                Boolean(
                    error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    error.code === 'ERR_NODE_COMPILE_CACHE_CONFIG_MISMATCH',
                ),
        );
    });

    it('permite owner sem ativação precoce sem habilitar a otimização tardiamente', () => {
        const config = readCopilotNodeCompileCacheConfig({ COPILOT_NODE_COMPILE_CACHE_DISABLED: '1' });
        const deactivate = activateCopilotNodeCompileCacheProcessOwner({
            token: Object.freeze({}),
            processId: 'compile-cache-owner-standalone',
            config,
        });
        const health = getCopilotNodeCompileCacheHealth();
        assert.equal(health.attempted, false);
        assert.deepEqual(health.owner, {
            active: true,
            processId: 'compile-cache-owner-standalone',
            adoption: 'not-activated',
        });
        deactivate();
    });

    it('recusa owner processual concorrente', () => {
        const config = readCopilotNodeCompileCacheConfig({ COPILOT_NODE_COMPILE_CACHE_DISABLED: '1' });
        const deactivate = activateCopilotNodeCompileCacheProcessOwner({
            token: Object.freeze({ owner: 'first' }),
            processId: 'compile-cache-owner-first',
            config,
        });
        assert.throws(
            () =>
                activateCopilotNodeCompileCacheProcessOwner({
                    token: Object.freeze({ owner: 'second' }),
                    processId: 'compile-cache-owner-second',
                    config,
                }),
            /** @param {unknown} error */ (error) =>
                Boolean(
                    error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    error.code === 'ERR_NODE_COMPILE_CACHE_OWNER_ACTIVE',
                ),
        );
        deactivate();
    });
});
