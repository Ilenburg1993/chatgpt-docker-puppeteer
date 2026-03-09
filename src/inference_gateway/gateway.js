// @ts-check

import { ollama as defaultOllamaClient } from '../../tools/ollama/client.mjs';
import { requireInferenceClientTag } from './client_tags.js';
import { resolveInferencePolicy, validateInferenceRoute } from './policy_config.js';

/**
 * @typedef {{
 *     generate?: number;
 *     embed?: number;
 *     listModels?: number;
 *     errors?: number;
 *     byClientTag: Record<string, number>;
 *     byOperation: Record<string, number>;
 * }} InferenceGatewayMetrics
 */

/**
 * @param {string} name
 * @param {number} fallback
 */
function parsePositiveIntEnv(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @returns {{
 *     timeoutMs: number;
 *     maxParallel: number;
 *     maxTokens: number | null;
 *     allowedModels: string[] | null;
 *     allowedBackends: string[] | null;
 *     degradedBehavior: 'degraded_continue' | 'fail_closed';
 * }}
 */
export function getInferenceEnvBootstrapPolicy() {
    const allowedModelsRaw = String(process.env.OLLAMA_LOCAL_ALLOWED_MODELS || '').trim();
    const allowedModels = allowedModelsRaw
        ? allowedModelsRaw
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
        : null;

    return {
        timeoutMs: parsePositiveIntEnv('AUDIT_AGENT_LLM_TIMEOUT_MS', 120000),
        maxParallel: parsePositiveIntEnv('AUDIT_AGENT_MAX_PARALLEL_LLM_CALLS', 1),
        maxTokens: (() => {
            const n = Number(process.env.OLLAMA_MAX_TOKENS);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        allowedModels,
        allowedBackends: null,
        degradedBehavior: 'degraded_continue',
    };
}

/**
 * Gateway de inferência para geração, embedding e listagem de modelos. Aplica políticas por cliente/perfil e controla
 * concorrência por clientTag.
 */
export class InferenceGateway {
    /**
     * @param {{
     *     ollamaClient?: unknown;
     *     now?: () => number;
     *     globalPolicy?: unknown;
     *     profilePolicies?: Record<string, unknown>;
     *     clientPolicies?: Record<string, unknown>;
     *     defaults?: unknown;
     * }} [options]
     */
    constructor(options = {}) {
        this.ollamaClient = options.ollamaClient || defaultOllamaClient;
        this.now = options.now || (() => Date.now());
        this.globalPolicy = options.globalPolicy || null;
        this.profilePolicies = options.profilePolicies || Object.create(null);
        this.clientPolicies = options.clientPolicies || Object.create(null);
        this.defaults = options.defaults || {
            timeoutMs: 120000,
            maxParallel: 1,
            degradedBehavior: 'degraded_continue',
        };
        this._inFlightByClient = new Map();
        /** @type {InferenceGatewayMetrics} */
        this.metrics = {
            generate: 0,
            embed: 0,
            listModels: 0,
            errors: 0,
            byClientTag: Object.create(null),
            byOperation: Object.create(null),
        };
    }

    /**
     * Atualiza policies em memória (reload explícito, sem reiniciar processo).
     *
     * @param {{
     *     globalPolicy?: unknown;
     *     profilePolicies?: Record<string, unknown>;
     *     clientPolicies?: Record<string, unknown>;
     * }} input
     */
    setPolicies(input = {}) {
        if (input.globalPolicy !== undefined) this.globalPolicy = input.globalPolicy || null;
        if (input.profilePolicies !== undefined) this.profilePolicies = input.profilePolicies || Object.create(null);
        if (input.clientPolicies !== undefined) this.clientPolicies = input.clientPolicies || Object.create(null);
        return this.getPolicySummary();
    }

    /**
     * @returns {{ globalPolicyPresent: boolean; profileCount: number; clientPolicyCount: number }}
     */
    getPolicySummary() {
        return {
            globalPolicyPresent: Boolean(this.globalPolicy),
            profileCount: Object.keys(this.profilePolicies || {}).length,
            clientPolicyCount: Object.keys(this.clientPolicies || {}).length,
        };
    }

    /**
     * @param {string} clientTag
     * @param {string} operation
     */
    _bumpMetric(clientTag, operation) {
        this.metrics.byClientTag[clientTag] = (this.metrics.byClientTag[clientTag] || 0) + 1;
        this.metrics.byOperation[operation] = (this.metrics.byOperation[operation] || 0) + 1;
        if (operation === 'generate') this.metrics.generate = (this.metrics.generate || 0) + 1;
        if (operation === 'embed') this.metrics.embed = (this.metrics.embed || 0) + 1;
        if (operation === 'listModels') this.metrics.listModels = (this.metrics.listModels || 0) + 1;
    }

    /**
     * @param {string} clientTag
     * @param {number} maxParallel
     */
    _acquire(clientTag, maxParallel) {
        const current = this._inFlightByClient.get(clientTag) || 0;
        if (current >= maxParallel) {
            const err = new Error(`limite de concorrência excedido para ${clientTag}`);
            /** @type {any} */ (err).code = 'INFERENCE_CONCURRENCY_LIMIT';
            /** @type {any} */ (err).statusCode = 429;
            throw err;
        }
        this._inFlightByClient.set(clientTag, current + 1);
    }

    /** @param {string} clientTag */
    _release(clientTag) {
        const current = this._inFlightByClient.get(clientTag) || 0;
        if (current <= 1) {
            this._inFlightByClient.delete(clientTag);
            return;
        }
        this._inFlightByClient.set(clientTag, current - 1);
    }

    /**
     * @param {{ clientTag: unknown; profileName?: string | undefined; overrides?: unknown }} options
     */
    resolvePolicy(options) {
        const clientTag = requireInferenceClientTag(options?.clientTag);
        const clientPolicy = this.clientPolicies[clientTag] || null;
        const profileName = String(
            options?.profileName ||
                /** @type {any} */ (clientPolicy)?.profile_name ||
                /** @type {any} */ (clientPolicy)?.profileName ||
                '',
        ).trim();
        return resolveInferencePolicy({
            clientTag,
            overrides: options?.overrides || null,
            clientPolicy,
            profilePolicy: profileName ? this.profilePolicies[profileName] || null : null,
            globalPolicy: this.globalPolicy,
            envPolicy: getInferenceEnvBootstrapPolicy(),
            defaults: this.defaults,
        });
    }

    /**
     * @param {{
     *     clientTag: unknown;
     *     profileName?: string;
     *     model?: string;
     *     backend?: string;
     *     policyOverrides?: unknown;
     * }} request
     */
    validateGenerate(request) {
        const policy = this.resolvePolicy({
            clientTag: request.clientTag,
            profileName: request.profileName,
            overrides: request.policyOverrides,
        });
        const routeCheck = validateInferenceRoute(policy.effective, {
            model: request.model || null,
            backend: request.backend || null,
        });
        return {
            ok: routeCheck.ok,
            clientTag: policy.clientTag,
            policy: policy.effective,
            route: {
                model: request.model || null,
                backend: request.backend || null,
                profileName: request.profileName || null,
            },
            reason: routeCheck.ok ? null : routeCheck.reason || 'route_not_allowed',
            ts: this.now(),
        };
    }

    /**
     * @param {{
     *     clientTag: unknown;
     *     prompt: string;
     *     model?: string;
     *     backend?: string;
     *     maxTokens?: number;
     *     runtime?: 'auto' | 'cloud' | 'local';
     *     profileName?: string;
     *     policyOverrides?: unknown;
     * }} request
     */
    async generate(request) {
        const policy = this.resolvePolicy({
            clientTag: request.clientTag,
            profileName: request.profileName,
            overrides: request.policyOverrides,
        });
        const clientTag = policy.clientTag;
        const routeCheck = validateInferenceRoute(policy.effective, {
            model: request.model || null,
            backend: request.backend || null,
        });
        if (!routeCheck.ok) {
            const err = new Error(routeCheck.reason || 'rota inválida');
            /** @type {any} */ (err).code = 'INFERENCE_ROUTE_NOT_ALLOWED';
            /** @type {any} */ (err).statusCode = 403;
            throw err;
        }

        const maxParallel = Math.max(1, Number(policy.effective.maxParallel || 1));
        this._acquire(clientTag, maxParallel);
        this._bumpMetric(clientTag, 'generate');
        try {
            const maxTokens = request.maxTokens ?? policy.effective.maxTokens ?? undefined;
            const result = await /** @type {any} */ (this.ollamaClient).generate(request.prompt, request.model, {
                max_tokens: maxTokens,
                runtime: request.runtime,
            });
            return {
                ok: true,
                clientTag,
                policy: policy.effective,
                result,
                ts: this.now(),
            };
        } catch (/** @type {any} */ error) {
            this.metrics.errors = (this.metrics.errors || 0) + 1;
            throw error;
        } finally {
            this._release(clientTag);
        }
    }

    /**
     * @param {{
     *     clientTag: unknown;
     *     text: string;
     *     model?: string;
     *     backend?: string;
     *     runtime?: 'auto' | 'cloud' | 'local';
     *     profileName?: string;
     *     policyOverrides?: unknown;
     * }} request
     */
    async embed(request) {
        const policy = this.resolvePolicy({
            clientTag: request.clientTag,
            profileName: request.profileName,
            overrides: request.policyOverrides,
        });
        const clientTag = policy.clientTag;
        const routeCheck = validateInferenceRoute(policy.effective, {
            model: request.model || null,
            backend: request.backend || null,
        });
        if (!routeCheck.ok) {
            const err = new Error(routeCheck.reason || 'rota inválida');
            /** @type {any} */ (err).code = 'INFERENCE_ROUTE_NOT_ALLOWED';
            /** @type {any} */ (err).statusCode = 403;
            throw err;
        }

        this._acquire(clientTag, Math.max(1, Number(policy.effective.maxParallel || 1)));
        this._bumpMetric(clientTag, 'embed');
        try {
            const result = await /** @type {any} */ (this.ollamaClient).embed(request.text, request.model, {
                runtime: request.runtime,
            });
            return {
                ok: true,
                clientTag,
                policy: policy.effective,
                result,
                ts: this.now(),
            };
        } catch (/** @type {any} */ error) {
            this.metrics.errors = (this.metrics.errors || 0) + 1;
            throw error;
        } finally {
            this._release(clientTag);
        }
    }

    /**
     * @param {{ clientTag: unknown; profileName?: string; policyOverrides?: unknown }} request
     */
    async listModels(request) {
        const policy = this.resolvePolicy({
            clientTag: request.clientTag,
            profileName: request.profileName,
            overrides: request.policyOverrides,
        });
        const clientTag = policy.clientTag;

        this._acquire(clientTag, Math.max(1, Number(policy.effective.maxParallel || 1)));
        this._bumpMetric(clientTag, 'listModels');
        try {
            const models = await /** @type {any} */ (this.ollamaClient).listModels();
            return {
                ok: true,
                clientTag,
                policy: policy.effective,
                models,
                ts: this.now(),
            };
        } catch (/** @type {any} */ error) {
            this.metrics.errors = (this.metrics.errors || 0) + 1;
            throw error;
        } finally {
            this._release(clientTag);
        }
    }

    getMetrics() {
        return {
            ...this.metrics,
            inFlightByClient: Object.fromEntries(this._inFlightByClient.entries()),
        };
    }
}

/**
 * Instância singleton do gateway de inferência usada pelo servidor HTTP do módulo.
 *
 * @type {InferenceGateway}
 */
export const inferenceGateway = new InferenceGateway();
