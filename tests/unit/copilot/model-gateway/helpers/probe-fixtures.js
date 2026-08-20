// @ts-check
/**
 * Fixtures canônicas para probes Model Gateway.
 *
 * Estado BYOK é produzido pelo parser real de configuração; runtime de sessão é uma porta estrutural deliberadamente
 * pequena. Isso impede que os testes mantenham cópias parciais dos schemas do SDK/Model Gateway.
 */

import {
    readConfiguredByokState,
    resolveConfiguredByokSessionOverrides,
} from '../../../../../src/copilot/sdk/session/provider.js';

/** @typedef {import('../../../../../src/copilot/model-gateway/probes/session-runtime.js').ModelGatewayProbeSessionRuntime} ModelGatewayProbeSessionRuntime */

/**
 * @param {Record<string, string | undefined>} env
 */
export function createByokProbeState(env) {
    return readConfiguredByokState(env);
}

/**
 * @param {{
 *     profile?: string;
 *     model?: string;
 *     providerType?: 'openai' | 'azure' | 'anthropic';
 *     baseUrl?: string;
 *     apiKey?: string;
 *     preset?: string;
 *     extraProfile?: Record<string, unknown>;
 *     summaryWarnings?: string[];
 * }} [options]
 */
export function createReadyByokProbeFixture(options = {}) {
    const profile = options.profile ?? 'repo_agent';
    const model = options.model ?? 'unit/model';
    const providerType = options.providerType ?? 'openai';
    const profileConfig = {
        providerType,
        baseUrl: options.baseUrl ?? 'https://unit.invalid/v1',
        apiKey: options.apiKey ?? 'unit-secret',
        model,
        preset: options.preset ?? 'custom',
        ...(options.extraProfile ?? {}),
    };
    const env = {
        COPILOT_BYOK_ENABLED: 'true',
        COPILOT_BYOK_PROFILE: profile,
        COPILOT_BYOK_PROFILES_JSON: JSON.stringify({ [profile]: profileConfig }),
    };
    const state = readConfiguredByokState(env);
    const overrides = resolveConfiguredByokSessionOverrides(env);
    if (options.summaryWarnings?.length) {
        state.summary = { ...state.summary, warnings: [...options.summaryWarnings] };
        overrides.summary = { ...overrides.summary, warnings: [...options.summaryWarnings] };
    }
    return { env, state, overrides };
}

/**
 * @param {Partial<ModelGatewayProbeSessionRuntime>} [overrides]
 * @returns {ModelGatewayProbeSessionRuntime}
 */
export function createProbeSessionRuntime(overrides = {}) {
    /** @type {ModelGatewayProbeSessionRuntime} */
    const base = {
        async withSession() {
            throw new Error('Unexpected Model Gateway probe session bootstrap in unit fixture');
        },
        subscribe() {
            return () => {};
        },
        async sendAndWait() {
            throw new Error('Unexpected Model Gateway probe sendAndWait in unit fixture');
        },
        async abort() {},
    };
    return { ...base, ...overrides };
}

/**
 * Runtime determinístico para probes chat/streaming/json/vision.
 *
 * @param {{
 *     sessionId?: string;
 *     finalContent: string;
 *     deltas?: string[];
 *     onConfig?: (config: Parameters<ModelGatewayProbeSessionRuntime['withSession']>[0]) => void;
 *     onMessage?: (message: import('@github/copilot-sdk').MessageOptions, timeoutMs: number) => void;
 *     onUnsubscribe?: () => void;
 * }} options
 * @returns {ModelGatewayProbeSessionRuntime}
 */
export function createReplyProbeSessionRuntime(options) {
    const session = Object.freeze({ probeSession: options.sessionId ?? 'unit-probe-session' });
    return createProbeSessionRuntime({
        async withSession(config, callback) {
            options.onConfig?.(config);
            await callback({ session, sessionId: options.sessionId ?? 'unit-probe-session' });
        },
        subscribe(_session, handlers) {
            for (const deltaContent of options.deltas ?? []) {
                handlers['assistant.message_delta']?.({ data: { deltaContent } });
            }
            handlers['assistant.message']?.({ data: { content: options.finalContent } });
            return () => options.onUnsubscribe?.();
        },
        async sendAndWait(_session, message, timeoutMs) {
            options.onMessage?.(message, timeoutMs);
            return { data: { content: options.finalContent } };
        },
    });
}
