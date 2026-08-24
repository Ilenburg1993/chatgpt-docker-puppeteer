// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildModelGatewayLiveRunEnvironment,
    buildModelGatewayLiveRunPlan,
    buildModelGatewayReadOnlyChildEnvironment,
} from '#copilot/testing/mcp/integrations/model-gateway/live-runs';

const PARENT_ENV = Object.freeze({
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/tmp/unit-home',
    LANG: 'C.UTF-8',
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
    it('keeps read-only and control-only children free of all ambient credential classes', () => {
        const readOnly = buildModelGatewayReadOnlyChildEnvironment(PARENT_ENV);
        const control = buildModelGatewayLiveRunEnvironment(
            { invokesModel: false, invokesRealProvider: false },
            PARENT_ENV,
        );
        for (const env of [readOnly, control]) {
            assert.equal(env['PATH'], PARENT_ENV.PATH);
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

    it('grants only recognized/explicit provider authority without granting Copilot or MCP credentials', () => {
        const env = buildModelGatewayLiveRunEnvironment({ invokesModel: false, invokesRealProvider: true }, PARENT_ENV);
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
