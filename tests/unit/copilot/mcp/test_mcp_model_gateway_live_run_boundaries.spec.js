// @ts-check

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';

import {
    buildModelGatewayLiveRunEnvironment,
    buildModelGatewayLiveRunPlan,
    buildModelGatewayReadinessChildEnvironment,
    buildModelGatewayReadOnlyChildEnvironment,
    createModelGatewayLiveRunEnvironmentAuthority,
    createModelGatewayLiveRunEnvironmentAuthorityWithDependencies,
    projectModelGatewayAuthorityFileEnvironment,
    spawnDetachedLiveRunWithDependencies,
} from '#copilot/testing/mcp/integrations/model-gateway/live-runs';

const PARENT_ENV = Object.freeze({
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/tmp/unit-home',
    LANG: 'C.UTF-8',
    COPILOT_DB_PATH: '/tmp/model-gateway-authority.sqlite',
    COPILOT_MCP_STATIC_BEARER_TOKEN: 'mcp-static-must-never-cross',
    FUTURE_UNKNOWN_SECRET: 'future-secret-must-never-cross',
    GITHUB_TOKEN: 'github-token-authority',
    COPILOT_GITHUB_TOKEN: 'copilot-github-token-authority',
    COPILOT_CONNECTION_TOKEN: 'copilot-connection-token-authority',
    OPENAI_API_KEY: 'openai-provider-authority',
    ANTHROPIC_API_KEY: 'anthropic-provider-authority',
    COPILOT_BYOK_API_KEY_ENV: 'CUSTOM_BYOK_SECRET',
    CUSTOM_BYOK_SECRET: 'custom-provider-authority',
    COPILOT_BYOK_ACCOUNT_UNIT__OPENAI_API_KEY: 'scoped-openai-provider-authority',
    COPILOT_BYOK_BASE_URL: 'https://provider.example.test/v1',
    COPILOT_LIVE_TEST_COPILOT_MODEL: 'unit-model',
});

/** @param {NodeJS.ProcessEnv} env @param {readonly string[]} keys */
function assertAbsent(env, keys) {
    for (const key of keys) assert.equal(env[key], undefined, `${key} must not cross this environment boundary`);
}

/** @param {NodeJS.ProcessEnv} env @param {readonly string[]} keys */
function assertPresent(env, keys) {
    for (const key of keys) assert.equal(typeof env[key], 'string', `${key} should cross this environment boundary`);
}

describe('MCP Model Gateway live-run authority boundaries', () => {
    it('captures a generation-bound opaque environment authority without serializing secrets', () => {
        const mutableEnv = { ...PARENT_ENV };
        const authority = createModelGatewayLiveRunEnvironmentAuthority(mutableEnv);
        mutableEnv.OPENAI_API_KEY = 'rotated-after-capture';
        mutableEnv.COPILOT_CONNECTION_TOKEN = 'rotated-copilot-after-capture';

        assert.equal(authority.readOnlyEnvironment()['OPENAI_API_KEY'], undefined);
        assert.equal(authority.readinessEnvironment()['OPENAI_API_KEY'], 'openai-provider-authority');
        assert.equal(authority.readinessEnvironment()['COPILOT_CONNECTION_TOKEN'], undefined);
        assert.equal(
            authority.liveRunEnvironment({ invokesModel: false, invokesRealProvider: true })['OPENAI_API_KEY'],
            'openai-provider-authority',
        );
        assert.equal(
            authority.liveRunEnvironment({ invokesModel: true, invokesRealProvider: false })[
                'COPILOT_CONNECTION_TOKEN'
            ],
            'copilot-connection-token-authority',
        );
        assert.equal(JSON.stringify(authority).includes('provider-authority'), false);
        assert.equal(JSON.stringify(authority).includes('copilot-connection-token-authority'), false);
        assert.equal(Object.isFrozen(authority), true);
        assert.equal(Object.isFrozen(authority.readOnlyEnvironment()), true);
        assert.equal(
            Object.isFrozen(authority.liveRunEnvironment({ invokesModel: true, invokesRealProvider: true })),
            true,
        );
    });
    it('projects only recognized Model Gateway file keys and prepares one sealed provider generation', async () => {
        const projected = projectModelGatewayAuthorityFileEnvironment({
            ZAI_API_KEY: 'zai-file-secret',
            CHUTES_API_KEY: 'chutes-file-secret',
            OPENROUTER_API_KEY: 'openrouter-file-secret',
            COPILOT_BYOK_PROFILES_JSON: '[{"id":"unit"}]',
            COPILOT_DB_PATH: '/tmp/file-must-not-own-application-db.sqlite',
            COPILOT_BYOK_API_KEY_ENV: 'CUSTOM_BYOK_SECRET',
            CUSTOM_BYOK_SECRET: 'custom-byok-file-secret',
            GITHUB_TOKEN: 'must-not-enter-file-projection',
            COPILOT_CONNECTION_TOKEN: 'must-not-enter-file-projection',
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'must-not-enter-file-projection',
            AURELIN_UNRELATED_SECRET: 'must-not-enter-file-projection',
        });
        assert.equal(projected['ZAI_API_KEY'], 'zai-file-secret');
        assert.equal(projected['CHUTES_API_KEY'], 'chutes-file-secret');
        assert.equal(projected['OPENROUTER_API_KEY'], 'openrouter-file-secret');
        assert.equal(projected['CUSTOM_BYOK_SECRET'], 'custom-byok-file-secret');
        assert.equal(projected['COPILOT_DB_PATH'], undefined);
        assert.equal(projected['GITHUB_TOKEN'], undefined);
        assert.equal(projected['COPILOT_CONNECTION_TOKEN'], undefined);
        assert.equal(projected['COPILOT_MCP_STATIC_BEARER_TOKEN'], undefined);
        assert.equal(projected['AURELIN_UNRELATED_SECRET'], undefined);

        let reads = 0;
        const authority = createModelGatewayLiveRunEnvironmentAuthorityWithDependencies(
            {
                PATH: '/usr/bin',
                COPILOT_DB_PATH: '/tmp/process-owned-application.sqlite',
                ZAI_API_KEY: 'zai-process-wins',
                COPILOT_CONNECTION_TOKEN: 'copilot-process-only',
            },
            {
                readEnvironmentFile: async () => {
                    reads += 1;
                    return [
                        'ZAI_API_KEY=zai-file-loses',
                        'COPILOT_DB_PATH=/tmp/file-must-not-override-process.sqlite',
                        'CHUTES_API_KEY=chutes-file-secret',
                        'OPENROUTER_API_KEY=openrouter-file-secret',
                        'GITHUB_TOKEN=must-not-enter',
                        'COPILOT_MCP_STATIC_BEARER_TOKEN=must-not-enter',
                    ].join('\n');
                },
            },
        );

        assert.equal(authority.liveRunEnvironment({ invokesRealProvider: true })['CHUTES_API_KEY'], undefined);
        await Promise.all([authority.prepare(), authority.prepare()]);
        await authority.prepare();
        assert.equal(reads, 1);

        const provider = authority.liveRunEnvironment({ invokesModel: false, invokesRealProvider: true });
        assert.equal(provider['ZAI_API_KEY'], 'zai-process-wins');
        assert.equal(provider['CHUTES_API_KEY'], 'chutes-file-secret');
        assert.equal(provider['OPENROUTER_API_KEY'], 'openrouter-file-secret');
        assert.equal(provider['COPILOT_CONNECTION_TOKEN'], undefined);
        assert.equal(provider['GITHUB_TOKEN'], undefined);
        assert.equal(provider['COPILOT_MCP_STATIC_BEARER_TOKEN'], undefined);

        const modelOnly = authority.liveRunEnvironment({ invokesModel: true, invokesRealProvider: false });
        assert.equal(modelOnly['COPILOT_CONNECTION_TOKEN'], 'copilot-process-only');
        assert.equal(modelOnly['ZAI_API_KEY'], undefined);
        assert.equal(modelOnly['CHUTES_API_KEY'], undefined);

        const readiness = authority.readinessEnvironment();
        assert.equal(readiness['COPILOT_DB_PATH'], '/tmp/process-owned-application.sqlite');
        assert.equal(readiness['ZAI_API_KEY'], 'zai-process-wins');
        assert.equal(readiness['CHUTES_API_KEY'], 'chutes-file-secret');
        assert.equal(readiness['COPILOT_CONNECTION_TOKEN'], undefined);
        assert.equal(readiness['GITHUB_TOKEN'], undefined);

        const readOnly = authority.readOnlyEnvironment();
        assert.equal(readOnly['ZAI_API_KEY'], undefined);
        assert.equal(readOnly['CHUTES_API_KEY'], undefined);
        assert.equal(readOnly['COPILOT_CONNECTION_TOKEN'], undefined);

        const serialized = JSON.stringify(authority);
        assert.equal(serialized.includes('zai-process-wins'), false);
        assert.equal(serialized.includes('chutes-file-secret'), false);
        assert.match(serialized, /"prepared":true/u);
    });

    it('keeps read-only and control-only children free of all ambient credential classes', () => {
        const readOnly = buildModelGatewayReadOnlyChildEnvironment(PARENT_ENV);
        const control = buildModelGatewayLiveRunEnvironment(
            { invokesModel: false, invokesRealProvider: false },
            PARENT_ENV,
        );
        for (const env of [readOnly, control]) {
            assert.equal(env['PATH'], PARENT_ENV.PATH);
            assert.equal(env['COPILOT_DB_PATH'], PARENT_ENV.COPILOT_DB_PATH);
            assert.equal(env['MODEL_GATEWAY_LOAD_DOTENV'], 'false');
            assert.equal(env['COPILOT_TERMINAL_LOAD_DOTENV_LOCAL'], 'false');
            assertAbsent(env, [
                'COPILOT_MCP_STATIC_BEARER_TOKEN',
                'FUTURE_UNKNOWN_SECRET',
                'GITHUB_TOKEN',
                'COPILOT_GITHUB_TOKEN',
                'COPILOT_CONNECTION_TOKEN',
                'OPENAI_API_KEY',
                'ANTHROPIC_API_KEY',
                'CUSTOM_BYOK_SECRET',
                'COPILOT_BYOK_ACCOUNT_UNIT__OPENAI_API_KEY',
                'COPILOT_BYOK_BASE_URL',
            ]);
        }
    });

    it('grants Copilot model credentials without granting provider or unrelated secrets', () => {
        const env = buildModelGatewayLiveRunEnvironment({ invokesModel: true, invokesRealProvider: false }, PARENT_ENV);
        assertPresent(env, ['GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN', 'COPILOT_CONNECTION_TOKEN']);
        assertAbsent(env, [
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'CUSTOM_BYOK_SECRET',
            'COPILOT_BYOK_ACCOUNT_UNIT__OPENAI_API_KEY',
            'COPILOT_BYOK_BASE_URL',
            'COPILOT_MCP_STATIC_BEARER_TOKEN',
            'FUTURE_UNKNOWN_SECRET',
        ]);
    });

    it('grants readiness only provider inspection authority without Copilot or MCP credentials', () => {
        const env = buildModelGatewayReadinessChildEnvironment(PARENT_ENV);
        assert.equal(env['COPILOT_DB_PATH'], PARENT_ENV.COPILOT_DB_PATH);
        assertPresent(env, [
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'CUSTOM_BYOK_SECRET',
            'COPILOT_BYOK_API_KEY_ENV',
            'COPILOT_BYOK_ACCOUNT_UNIT__OPENAI_API_KEY',
            'COPILOT_BYOK_BASE_URL',
        ]);
        assertAbsent(env, [
            'GITHUB_TOKEN',
            'COPILOT_GITHUB_TOKEN',
            'COPILOT_CONNECTION_TOKEN',
            'COPILOT_MCP_STATIC_BEARER_TOKEN',
            'FUTURE_UNKNOWN_SECRET',
        ]);
    });

    it('grants only recognized/explicit provider authority without granting Copilot or MCP credentials', () => {
        const env = buildModelGatewayLiveRunEnvironment({ invokesModel: false, invokesRealProvider: true }, PARENT_ENV);
        assert.equal(env['COPILOT_DB_PATH'], PARENT_ENV.COPILOT_DB_PATH);
        assertPresent(env, [
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'CUSTOM_BYOK_SECRET',
            'COPILOT_BYOK_API_KEY_ENV',
            'COPILOT_BYOK_ACCOUNT_UNIT__OPENAI_API_KEY',
            'COPILOT_BYOK_BASE_URL',
        ]);
        assertAbsent(env, [
            'GITHUB_TOKEN',
            'COPILOT_GITHUB_TOKEN',
            'COPILOT_CONNECTION_TOKEN',
            'COPILOT_MCP_STATIC_BEARER_TOKEN',
            'FUTURE_UNKNOWN_SECRET',
        ]);
    });

    it('terminates and drains a detached run when cancellation wins during manifest publication', async () => {
        const controller = new AbortController();
        const childEmitter = new EventEmitter();
        let killCalls = 0;
        let unrefCalled = false;
        const child = Object.assign(childEmitter, {
            pid: 515151,
            kill(signal) {
                killCalls += 1;
                queueMicrotask(() => childEmitter.emit('close', null, signal));
                return true;
            },
            unref() {
                unrefCalled = true;
            },
        });
        const manifestWrites = [];
        const deleted = [];
        let logClosed = false;
        const workspace = {
            workspaceRoot: '/workspace',
            io: {
                mkdirPathLocked: async () => ({}),
                openDetachedAppendSink: async () => ({
                    handle: {
                        fd: 99,
                        close: async () => {
                            logClosed = true;
                        },
                    },
                }),
                writeFileAtomic: async (path, content) => {
                    manifestWrites.push([path, content]);
                    controller.abort(new Error('cancel-during-manifest-publication'));
                    return {};
                },
                deleteFileLocked: async (path) => {
                    deleted.push(path);
                    return {};
                },
            },
        };
        const spawnChild = /** @type {typeof import('node:child_process').spawn} */ (
            /** @type {unknown} */ (
                () => {
                    queueMicrotask(() => childEmitter.emit('spawn'));
                    return child;
                }
            )
        );
        const authority = createModelGatewayLiveRunEnvironmentAuthority(PARENT_ENV);

        await assert.rejects(
            spawnDetachedLiveRunWithDependencies(
                {
                    workspace: /** @type {any} */ (workspace),
                    args: ['--control-only'],
                    plan: { invokesModel: false, invokesRealProvider: false },
                    timeoutMs: 30_000,
                    signal: controller.signal,
                    environmentAuthority: authority,
                    ownerPrincipalKey: 'test-llmb-owner-a',
                },
                {
                    createRunUuid: () => '11111111-1111-4111-8111-111111111111',
                    spawnChild,
                },
            ),
            /cancel-during-manifest-publication/u,
        );

        assert.equal(manifestWrites.length, 1);
        assert.equal(deleted.length, 1);
        assert.equal(
            deleted[0],
            '/workspace/src/copilot/.ai/mcp/llmb-live-runs/mcp-11111111-1111-4111-8111-111111111111.json',
        );
        assert.ok(killCalls >= 1);
        assert.equal(unrefCalled, false);
        assert.equal(logClosed, true);
    });

    it('transfers detached lifecycle only after a durable manifest is accepted', async () => {
        const childEmitter = new EventEmitter();
        let killCalls = 0;
        let unrefCalled = false;
        const child = Object.assign(childEmitter, {
            pid: 515152,
            kill() {
                killCalls += 1;
                return true;
            },
            unref() {
                unrefCalled = true;
            },
        });
        let manifestWrites = 0;
        const workspace = {
            workspaceRoot: '/workspace',
            io: {
                mkdirPathLocked: async () => ({}),
                openDetachedAppendSink: async () => ({ handle: { fd: 99, close: async () => {} } }),
                writeFileAtomic: async () => {
                    manifestWrites += 1;
                    return {};
                },
                deleteFileLocked: async () => {
                    throw new Error('accepted manifest must not be deleted');
                },
            },
        };
        const spawnChild = /** @type {typeof import('node:child_process').spawn} */ (
            /** @type {unknown} */ (
                () => {
                    queueMicrotask(() => childEmitter.emit('spawn'));
                    return child;
                }
            )
        );
        const authority = createModelGatewayLiveRunEnvironmentAuthority(PARENT_ENV);
        const manifest = await spawnDetachedLiveRunWithDependencies(
            {
                workspace: /** @type {any} */ (workspace),
                args: ['--control-only'],
                plan: { invokesModel: false, invokesRealProvider: false },
                timeoutMs: 30_000,
                environmentAuthority: authority,
                ownerPrincipalKey: 'test-llmb-owner-a',
            },
            {
                createRunUuid: () => '22222222-2222-4222-8222-222222222222',
                spawnChild,
            },
        );
        assert.equal(manifestWrites, 1);
        assert.equal(manifest.pid, 515152);
        assert.equal(manifest.ownerPrincipalKey, 'test-llmb-owner-a');
        assert.equal(manifest.timeoutMs, 30_000);
        assert.equal(manifest.deadlineAtMs, manifest.startedAtMs + 30_000);
        assert.equal(unrefCalled, true);
        assert.equal(killCalls, 0);
    });

    it('derives execution and credential authority truthfully from the semantic plan', () => {
        const control = buildModelGatewayLiveRunPlan({
            mode: 'control-only',
            scenario: 'canonical',
            transport: 'stdio',
            timeoutMs: 30_000,
        });
        assert.equal(control.invokesModel, false);
        assert.equal(control.invokesRealProvider, false);
        assert.equal(control.requiresUsageConfirmation, false);
        assert.equal(control.executionMode, 'synchronous');

        const copilotTurn = buildModelGatewayLiveRunPlan({
            mode: 'canonical-turn',
            scenario: 'canonical',
            transport: 'stdio',
            timeoutMs: 30_000,
        });
        assert.equal(copilotTurn.invokesModel, true);
        assert.equal(copilotTurn.invokesRealProvider, false);
        assert.equal(copilotTurn.requiresUsageConfirmation, true);

        const adaptiveTurn = buildModelGatewayLiveRunPlan({
            mode: 'canonical-turn',
            scenario: 'model-gateway-tools-apply-safe',
            transport: 'stdio',
            timeoutMs: 30_000,
        });
        assert.equal(adaptiveTurn.resolvedScenario, 'model-gateway-adaptive-probe');
        assert.equal(adaptiveTurn.invokesModel, true);
        assert.equal(adaptiveTurn.invokesRealProvider, true);
        assert.equal(adaptiveTurn.executesRuntimeProbes, true);
        assert.equal(adaptiveTurn.executionMode, 'detached');

        const providerControl = buildModelGatewayLiveRunPlan({
            mode: 'byok-real-control',
            scenario: 'canonical',
            transport: 'stdio',
            timeoutMs: 30_000,
            byokProfile: 'unit-profile',
        });
        assert.equal(providerControl.invokesModel, false);
        assert.equal(providerControl.invokesRealProvider, true);
        assert.equal(providerControl.requiresUsageConfirmation, true);
        assert.ok(providerControl.args.includes('--byok-real'));
        assert.ok(providerControl.args.includes('--control-only'));
    });
});
