// @ts-check
/** Planning semantics for governed Model Gateway / LLM-B live operations. */

import { MODEL_GATEWAY_LIVE_RUNNER_SCRIPT } from './contracts.js';

const PROFILE_RE = /^[A-Za-z0-9_.:-]{1,120}$/u;

/**
 * @typedef {'control-only' | 'dry-run' | 'canonical-turn' | 'byok-fixture-control' | 'byok-real-control' | 'byok-real-turn'} ModelGatewayLiveMode
 * @typedef {'pty' | 'stdio'} ModelGatewayLiveTransport
 * @typedef {'metadata_first' | 'prefer_runtime_proved' | 'require_runtime_proof'} ModelGatewaySelectionPolicy
 * @typedef {Readonly<{
 *     script: string;
 *     args: string[];
 *     mode: ModelGatewayLiveMode;
 *     scenario: string;
 *     requestedScenario: string;
 *     resolvedScenario: string;
 *     executionMode: 'synchronous' | 'detached';
 *     invokesModel: boolean;
 *     invokesRealProvider: boolean;
 *     executesRuntimeProbes: boolean;
 *     requiresUsageConfirmation: boolean;
 *     billingNote: string;
 * }>} ModelGatewayLiveRunPlan
 */

/** @param {string} value @param {string} field */
function validateProfile(value, field) {
    if (!PROFILE_RE.test(value)) throw new Error(`${field} contains unsupported characters.`);
    return value;
}

/**
 * @param {{
 *     mode: ModelGatewayLiveMode;
 *     scenario: string;
 *     transport: ModelGatewayLiveTransport;
 *     timeoutMs: number;
 *     byokProfile?: string;
 *     routeProfile?: string;
 *     selectionPolicy?: ModelGatewaySelectionPolicy;
 * }} input
 * @returns {ModelGatewayLiveRunPlan}
 */
export function buildModelGatewayLiveRunPlan(input) {
    const requestedScenario = input.scenario;
    const adaptiveModelGatewayTurn =
        (input.mode === 'byok-real-turn' || input.mode === 'canonical-turn') &&
        requestedScenario === 'model-gateway-tools-apply-safe';
    const resolvedScenario = adaptiveModelGatewayTurn ? 'model-gateway-adaptive-probe' : requestedScenario;
    const args = [
        `--live-scenario=${resolvedScenario}`,
        `--transport=${input.transport}`,
        `--timeout-ms=${input.timeoutMs}`,
    ];
    let invokesModel = false;
    let invokesRealProvider = false;
    let executesRuntimeProbes = false;

    if (input.mode === 'dry-run') {
        args.push('--dry-run', '--control-only');
    } else if (input.mode === 'control-only') {
        args.push('--control-only');
    } else if (input.mode === 'canonical-turn') {
        invokesModel = true;
        if (resolvedScenario === 'model-gateway-adaptive-probe') {
            args.push('--model-gateway-control-plane-probes');
            invokesRealProvider = true;
            executesRuntimeProbes = true;
        }
    } else if (input.mode === 'byok-fixture-control') {
        args.push('--byok-probe', '--byok-fixture', '--control-only');
        executesRuntimeProbes = true;
    } else {
        args.push('--byok-real');
        invokesRealProvider = true;
        if (input.byokProfile) args.push(`--byok-real-profile=${validateProfile(input.byokProfile, 'byokProfile')}`);
        if (input.routeProfile) {
            args.push(`--byok-real-route-profile=${validateProfile(input.routeProfile, 'routeProfile')}`);
        }
        if (input.selectionPolicy) args.push(`--byok-real-route-selection-policy=${input.selectionPolicy}`);
        if (input.mode === 'byok-real-control') {
            args.push('--control-only');
            executesRuntimeProbes = true;
        } else {
            invokesModel = true;
            executesRuntimeProbes = Boolean(input.routeProfile);
        }
    }

    const requiresUsageConfirmation = invokesModel || invokesRealProvider;
    const executionMode =
        resolvedScenario === 'model-gateway-adaptive-probe' &&
        (input.mode === 'byok-real-turn' || input.mode === 'canonical-turn')
            ? 'detached'
            : 'synchronous';

    return Object.freeze({
        script: MODEL_GATEWAY_LIVE_RUNNER_SCRIPT,
        args,
        mode: input.mode,
        scenario: resolvedScenario,
        requestedScenario,
        resolvedScenario,
        executionMode,
        invokesModel,
        invokesRealProvider,
        executesRuntimeProbes,
        requiresUsageConfirmation,
        billingNote:
            invokesModel && invokesRealProvider
                ? 'GitHub Copilot AI Credits/token usage and BYOK/provider quota or billing may be consumed.'
                : invokesRealProvider
                  ? 'BYOK/provider quota or billing may be consumed.'
                  : invokesModel
                    ? 'GitHub Copilot AI Credits/token usage may be consumed.'
                    : 'No explicit model turn is requested by this plan.',
    });
}
