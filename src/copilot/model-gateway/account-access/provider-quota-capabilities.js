// @ts-check
/**
 * Provider quota/account capability matrix.
 *
 * This is operator-facing metadata about what can be known before runtime. It deliberately describes provider/account
 * surfaces; it is not a canonical model fact and it does not execute network calls.
 *
 * @module copilot/model-gateway/account-access/provider-quota-capabilities
 */

const CAPABILITY_ROWS = Object.freeze([
    {
        providerId: 'anthropic',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'headers_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['ANTHROPIC_API_KEY'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'cerebras',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'headers_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['CEREBRAS_API_KEY'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'chutes',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'headers_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['CHUTES_API_KEY'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'cloudflare-workers-ai',
        accountVisibility: 'account_models_and_gateway',
        quotaSnapshot: 'credit_balance',
        spendingLimit: 'account_spending_limit',
        rateLimit: 'gateway_rate_limit',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
        endpoints: [
            '/accounts/{account_id}/ai/models/search',
            '/accounts/{account_id}/ai-gateway/gateways',
            '/accounts/{account_id}/ai-gateway/billing/credit-balance',
            '/accounts/{account_id}/ai-gateway/billing/spending-limit',
        ],
    },
    {
        providerId: 'gemini',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'importer_failure_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['GEMINI_API_KEY'],
        endpoints: ['/v1beta/models'],
    },
    {
        providerId: 'groq',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'docs_and_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['GROQ_API_KEY'],
        endpoints: ['/openai/v1/models'],
    },
    {
        providerId: 'huggingface',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'headers_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['HF_TOKEN'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'kilo',
        accountVisibility: 'authenticated_gateway_providers',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'runtime_failure_only',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['KILO_API_KEY'],
        endpoints: ['/api/gateway/models', '/api/gateway/providers'],
    },
    {
        providerId: 'mistral',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'docs_and_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['MISTRAL_API_KEY'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'nvidia-nim',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'headers_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['NVIDIA_API_KEY'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'ollama-local',
        accountVisibility: 'local_daemon_models',
        quotaSnapshot: 'not_applicable',
        spendingLimit: 'not_applicable',
        rateLimit: 'local_resource_bound',
        runtimeFailureOverlay: false,
        sdkQuotaAppliesToByok: false,
        requiredEnv: [],
        endpoints: ['/api/tags', '/v1/models'],
    },
    {
        providerId: 'opencode',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'runtime_failure_only',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['OPENCODE_API_KEY'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'openai',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'sdk_entitlement_separate',
        spendingLimit: 'unknown',
        rateLimit: 'headers_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['OPENAI_API_KEY'],
        endpoints: ['/v1/models'],
    },
    {
        providerId: 'openrouter',
        accountVisibility: 'key_account_and_public_models',
        quotaSnapshot: 'key_credit_balance',
        spendingLimit: 'key_credit_balance',
        rateLimit: 'headers_or_runtime_failure',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['OPENROUTER_API_KEY'],
        endpoints: ['/api/v1/models', '/api/v1/key'],
    },
    {
        providerId: 'zai',
        accountVisibility: 'authenticated_models',
        quotaSnapshot: 'runtime_failure_only',
        spendingLimit: 'unknown',
        rateLimit: 'runtime_failure_only',
        runtimeFailureOverlay: true,
        sdkQuotaAppliesToByok: false,
        requiredEnv: ['ZAI_API_KEY'],
        endpoints: ['/api/paas/v4/models'],
    },
]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {string | null} selector
 * @param {(typeof CAPABILITY_ROWS)[number]} row
 * @returns {boolean}
 */
function matchesSelector(selector, row) {
    if (!selector) return true;
    const needle = selector.toLowerCase();
    return [
        row.providerId,
        row.accountVisibility,
        row.quotaSnapshot,
        row.spendingLimit,
        row.rateLimit,
        ...row.requiredEnv,
        ...row.endpoints,
    ]
        .map((value) => value.toLowerCase())
        .some((value) => value.includes(needle));
}

/**
 * @param {object} [options]
 * @param {string | null} [options.selector]
 * @returns {(typeof CAPABILITY_ROWS)[number][]}
 */
export function listModelGatewayProviderQuotaCapabilities(options = {}) {
    const selector = optionalString(options.selector);
    return CAPABILITY_ROWS.filter((row) => matchesSelector(selector, row));
}

/**
 * @param {object} [options]
 * @param {string | null} [options.selector]
 * @returns {{
 *     rows: ReturnType<typeof listModelGatewayProviderQuotaCapabilities>;
 *     summary: {
 *         total: number;
 *         matched: number;
 *         providerCount: number;
 *         accountVisibilityCount: number;
 *         quotaSnapshotCount: number;
 *         runtimeFailureOverlayCount: number;
 *         sdkQuotaByokTruthCount: number;
 *         byQuotaSnapshot: Record<string, number>;
 *     };
 * }}
 */
export function summarizeModelGatewayProviderQuotaCapabilities(options = {}) {
    const rows = listModelGatewayProviderQuotaCapabilities(options);
    /** @type {Record<string, number>} */
    const byQuotaSnapshot = {};
    for (const row of rows) byQuotaSnapshot[row.quotaSnapshot] = (byQuotaSnapshot[row.quotaSnapshot] ?? 0) + 1;
    return {
        rows,
        summary: {
            total: CAPABILITY_ROWS.length,
            matched: rows.length,
            providerCount: new Set(rows.map((row) => row.providerId)).size,
            accountVisibilityCount: rows.filter((row) => row.accountVisibility !== 'none').length,
            quotaSnapshotCount: rows.filter(
                (row) => !['runtime_failure_only', 'not_applicable', 'unknown'].includes(row.quotaSnapshot),
            ).length,
            runtimeFailureOverlayCount: rows.filter((row) => row.runtimeFailureOverlay).length,
            sdkQuotaByokTruthCount: rows.filter((row) => row.sdkQuotaAppliesToByok).length,
            byQuotaSnapshot,
        },
    };
}
