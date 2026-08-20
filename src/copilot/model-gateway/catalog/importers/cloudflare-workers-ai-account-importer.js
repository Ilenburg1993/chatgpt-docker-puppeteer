// @ts-check
/**
 * Cloudflare Workers AI / AI Gateway account importer.
 *
 * This importer is deliberately account-scoped and pre-runtime. It queries Cloudflare control-plane/account APIs to
 * learn which models and gateway controls are visible to the configured key, without executing a model.
 *
 * Sources checked 2026-05-26:
 * - https://developers.cloudflare.com/api/resources/ai/subresources/models/methods/list/
 * - https://developers.cloudflare.com/api/resources/ai_gateway/
 *
 * @module copilot/model-gateway/catalog/importers/cloudflare-workers-ai-account-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createProviderAccountOverlay,
    createProviderMetadataEvidence,
} from '../contracts.js';
import { normalizeAccountOverlayControls } from '../normalizers.js';
import { readCatalogResponseJson, readCatalogResponseText } from './response-body.js';

export const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
export const CLOUDFLARE_WORKERS_AI_MODELS_SEARCH_PATH = '/accounts/{account_id}/ai/models/search';
export const CLOUDFLARE_AI_GATEWAY_GATEWAYS_PATH = '/accounts/{account_id}/ai-gateway/gateways';
export const CLOUDFLARE_AI_GATEWAY_GATEWAY_PATH = '/accounts/{account_id}/ai-gateway/gateways/{gateway_id}';
export const CLOUDFLARE_AI_GATEWAY_PROVIDER_CONFIGS_PATH = '/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/provider_configs';
export const CLOUDFLARE_AI_GATEWAY_CREDIT_BALANCE_PATH = '/accounts/{account_id}/ai-gateway/billing/credit-balance';
export const CLOUDFLARE_AI_GATEWAY_SPENDING_LIMIT_PATH = '/accounts/{account_id}/ai-gateway/billing/spending-limit';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function pathPart(value) {
    return encodeURIComponent(value).replace(/%2F/giu, '/');
}

/**
 * @param {string} path
 * @param {string} accountId
 * @param {string | undefined} gatewayId
 * @returns {string}
 */
function fillPath(path, accountId, gatewayId) {
    return path
        .replace('{account_id}', pathPart(accountId))
        .replace('{gateway_id}', gatewayId ? pathPart(gatewayId) : '{gateway_id}');
}

/**
 * @param {Record<string, unknown>} envelope
 * @returns {unknown}
 */
function cloudflareResult(envelope) {
    return Object.prototype.hasOwnProperty.call(envelope, 'result') ? envelope['result'] : envelope;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function resultArray(value) {
    if (Array.isArray(value)) return value.filter(isRecord);
    if (!isRecord(value)) return [];
    const result = cloudflareResult(value);
    if (Array.isArray(result)) return result.filter(isRecord);
    if (isRecord(result) && Array.isArray(result['models'])) return result['models'].filter(isRecord);
    if (isRecord(result) && Array.isArray(result['items'])) return result['items'].filter(isRecord);
    return [];
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function resultRecord(value) {
    if (!isRecord(value)) return null;
    const result = cloudflareResult(value);
    return isRecord(result) ? result : value;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string | null}
 */
function providerModel(row) {
    return (
        stringValue(row['id']) ??
        stringValue(row['model']) ??
        stringValue(row['name']) ??
        stringValue(row['model_name']) ??
        stringValue(row['source'])
    );
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string | null}
 */
function gatewayId(row) {
    return stringValue(row['id']) ?? stringValue(row['gateway_id']) ?? stringValue(row['slug']) ?? stringValue(row['name']);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string | null}
 */
function providerConfigSlug(row) {
    return (
        stringValue(row['provider']) ??
        stringValue(row['provider_slug']) ??
        stringValue(row['name']) ??
        stringValue(row['id'])
    );
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeCloudflareValue(value) {
    if (Array.isArray(value)) return value.map(sanitizeCloudflareValue);
    if (!isRecord(value)) return value;
    /** @type {Record<string, unknown>} */
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase();
        if (
            /(?:authorization|bearer|token|api[_-]?key|secret|credential|password|private|payment|card|last4)/iu.test(
                normalizedKey,
            )
        ) {
            sanitized[key] = '[REDACTED]';
            continue;
        }
        sanitized[key] = sanitizeCloudflareValue(entry);
    }
    return sanitized;
}

/**
 * @param {Record<string, unknown> | null} gateway
 * @returns {{ rateLimits: Record<string, number>; providerMetadata: Record<string, unknown> }}
 */
function gatewayControls(gateway) {
    if (!gateway) return { rateLimits: {}, providerMetadata: {} };
    const limit =
        finiteNumber(gateway['rate_limiting_limit']) ??
        finiteNumber(gateway['rateLimitingLimit']) ??
        finiteNumber(gateway['rate_limit']) ??
        finiteNumber(gateway['requests_limit']);
    const intervalSeconds =
        finiteNumber(gateway['rate_limiting_interval']) ??
        finiteNumber(gateway['rateLimitingInterval']) ??
        finiteNumber(gateway['rate_limit_interval']) ??
        finiteNumber(gateway['interval']);
    const requestsPerMinute =
        typeof limit === 'number' && typeof intervalSeconds === 'number' && intervalSeconds > 0
            ? Math.round((limit * 60) / intervalSeconds)
            : null;
    return {
        rateLimits: {
            ...(typeof limit === 'number' ? { limitRequests: limit } : {}),
            ...(typeof intervalSeconds === 'number' ? { intervalSeconds } : {}),
            ...(typeof requestsPerMinute === 'number' ? { requestsPerMinute } : {}),
        },
        providerMetadata: {
            ...(typeof limit === 'number' ? { gatewayRateLimitRequests: limit } : {}),
            ...(typeof intervalSeconds === 'number' ? { gatewayRateLimitIntervalSeconds: intervalSeconds } : {}),
        },
    };
}

/**
 * @param {Record<string, unknown> | null} creditBalance
 * @returns {Record<string, number>}
 */
function quotaFromCreditBalance(creditBalance) {
    if (!creditBalance) return {};
    const balance =
        finiteNumber(creditBalance['balance']) ??
        finiteNumber(creditBalance['remaining']) ??
        finiteNumber(creditBalance['remaining_credits']) ??
        finiteNumber(creditBalance['credits']);
    return typeof balance === 'number' ? { remainingCreditsUsd: balance } : {};
}

/**
 * @param {Record<string, unknown> | null} spendingLimit
 * @returns {{ spendingLimits: Record<string, number | string>; providerMetadata: Record<string, unknown> }}
 */
function spendingFromLimit(spendingLimit) {
    if (!spendingLimit) return { spendingLimits: {}, providerMetadata: {} };
    const enabled = spendingLimit['enabled'] === true;
    const amountCents =
        finiteNumber(spendingLimit['amount']) ??
        finiteNumber(spendingLimit['amount_cents']) ??
        finiteNumber(spendingLimit['limit_cents']);
    const hardLimitUsd = typeof amountCents === 'number' ? amountCents / 100 : null;
    return {
        spendingLimits: {
            ...(typeof hardLimitUsd === 'number' ? { hardLimitUsd, currency: 'USD' } : {}),
        },
        providerMetadata: {
            spendingLimitEnabled: enabled,
            ...(typeof amountCents === 'number' ? { spendingLimitAmountCents: amountCents } : {}),
        },
    };
}

/**
 * @param {string} name
 * @param {string} url
 * @param {import('./http-port.js').CatalogFetch} fetchImpl
 * @param {string} apiToken
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchCloudflareEndpoint(name, url, fetchImpl, apiToken) {
    const response = await fetchImpl(url, {
        headers: {
            accept: 'application/json',
            authorization: `Bearer ${apiToken}`,
        },
    });
    /** @type {unknown} */
    let body;
    const contentType = response.headers?.get?.('content-type') ?? '';
    try {
        body = contentType.includes('application/json') || (!response.body && typeof response.json === 'function')
            ? await readCatalogResponseJson(response, { label: `Cloudflare account ${name}` })
            : await readCatalogResponseText(response, { label: `Cloudflare account ${name}` });
    } catch (error) {
        body = { parseError: error instanceof Error ? error.message : 'unknown response parse error' };
    }
    return {
        name,
        url,
        ok: response.ok,
        status: response.status,
        body: sanitizeCloudflareValue(body),
    };
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
export function parseCloudflareWorkersAiAccountRows(raw) {
    return isRecord(raw) ? [raw] : [];
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} name
 * @returns {Record<string, unknown> | null}
 */
function endpoint(raw, name) {
    const endpoints = isRecord(raw['endpoints']) ? raw['endpoints'] : {};
    const value = endpoints[name];
    return isRecord(value) ? value : null;
}

/**
 * @param {Record<string, unknown> | null} endpointRecord
 * @returns {unknown}
 */
function endpointBody(endpointRecord) {
    return endpointRecord ? endpointRecord['body'] : null;
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>[]}
 */
function accountModels(raw) {
    return resultArray(endpointBody(endpoint(raw, 'modelsSearch')));
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>[]}
 */
function gateways(raw) {
    return resultArray(endpointBody(endpoint(raw, 'gateways')));
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>[]}
 */
function providerConfigs(raw) {
    return resultArray(endpointBody(endpoint(raw, 'providerConfigs')));
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown> | null}
 */
function selectedGateway(raw) {
    const configured = stringValue(raw['gatewayId']);
    const byDetail = resultRecord(endpointBody(endpoint(raw, 'gateway')));
    if (byDetail) return byDetail;
    if (!configured) return null;
    return gateways(raw).find((item) => gatewayId(item) === configured) ?? null;
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function providerEvidenceValues(raw) {
    const modelRows = accountModels(raw);
    const gatewayRows = gateways(raw);
    const selected = selectedGateway(raw);
    const configs = providerConfigs(raw);
    const creditBalance = resultRecord(endpointBody(endpoint(raw, 'creditBalance')));
    const spendingLimit = resultRecord(endpointBody(endpoint(raw, 'spendingLimit')));
    const endpointRows = Object.values(isRecord(raw['endpoints']) ? raw['endpoints'] : {}).filter(isRecord);
    const statusByEndpoint = Object.fromEntries(
        endpointRows.map((item) => [stringValue(item['name']) ?? 'unknown', { ok: item['ok'] === true, status: finiteNumber(item['status']) }]),
    );
    return [
        { fieldPath: 'providerMetadata.cloudflare.accountApi.endpointStatuses', value: statusByEndpoint },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.visibleModelCount', value: modelRows.length },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.visibleModels', value: modelRows.map(providerModel).filter(Boolean) },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.gatewayCount', value: gatewayRows.length },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.gatewayIds', value: gatewayRows.map(gatewayId).filter(Boolean) },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.selectedGatewayFound', value: Boolean(selected) },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.providerConfigCount', value: configs.length },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.providerConfigProviders', value: configs.map(providerConfigSlug).filter(Boolean) },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.creditBalance', value: creditBalance },
        { fieldPath: 'providerMetadata.cloudflare.accountApi.spendingLimit', value: spendingLimit },
    ].filter((item) => {
        if (item.value === null || item.value === undefined) return false;
        if (Array.isArray(item.value) && item.value.length === 0) return false;
        if (isRecord(item.value) && Object.keys(item.value).length === 0) return false;
        return true;
    });
}

/**
 * @param {object} [options]
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.apiToken]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountId]
 * @param {string} [options.gatewayId]
 * @param {string} [options.baseUrl]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createCloudflareWorkersAiAccountImporter(options = {}) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const baseUrl = options.baseUrl ?? CLOUDFLARE_API_BASE_URL;
    const accountId = options.accountId;
    const gatewayIdValue = options.gatewayId;
    const modelsSearchUrl = accountId
        ? `${baseUrl}${fillPath(CLOUDFLARE_WORKERS_AI_MODELS_SEARCH_PATH, accountId, gatewayIdValue)}`
        : `${baseUrl}${CLOUDFLARE_WORKERS_AI_MODELS_SEARCH_PATH}`;
    return {
        id: 'cloudflare-workers-ai-account',
        providerId: 'cloudflare-workers-ai',
        sourceKind: 'authenticated_account_api',
        requiresAuth: true,
        url: modelsSearchUrl,
        envRequirements: [
            'CLOUDFLARE_API_TOKEN',
            'CLOUDFLARE_API_KEY',
            'CLOUDFLARE_KEY',
            'CLOUDFLARE_ACCOUNT_ID',
            'CLOUDFLARE_AI_GATEWAY_ID',
        ],
        refreshPolicy: 'manual',
        ttlSeconds: 900,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Cloudflare account import');
            if (!options.apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required for Cloudflare account import');
            if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required for Cloudflare account import');
            const endpoints = {
                modelsSearch: `${baseUrl}${fillPath(CLOUDFLARE_WORKERS_AI_MODELS_SEARCH_PATH, accountId, gatewayIdValue)}`,
                gateways: `${baseUrl}${fillPath(CLOUDFLARE_AI_GATEWAY_GATEWAYS_PATH, accountId, gatewayIdValue)}`,
                ...(gatewayIdValue
                    ? {
                          gateway: `${baseUrl}${fillPath(CLOUDFLARE_AI_GATEWAY_GATEWAY_PATH, accountId, gatewayIdValue)}`,
                          providerConfigs: `${baseUrl}${fillPath(CLOUDFLARE_AI_GATEWAY_PROVIDER_CONFIGS_PATH, accountId, gatewayIdValue)}`,
                      }
                    : {}),
                creditBalance: `${baseUrl}${fillPath(CLOUDFLARE_AI_GATEWAY_CREDIT_BALANCE_PATH, accountId, gatewayIdValue)}`,
                spendingLimit: `${baseUrl}${fillPath(CLOUDFLARE_AI_GATEWAY_SPENDING_LIMIT_PATH, accountId, gatewayIdValue)}`,
            };
            const entries = await Promise.all(
                Object.entries(endpoints).map(([name, url]) => fetchCloudflareEndpoint(name, url, fetchImpl, options.apiToken ?? '')),
            );
            const endpointMap = Object.fromEntries(entries.map((item) => [String(item['name']), item]));
            const accountCoreSucceeded = Boolean(endpointMap['modelsSearch']?.['ok'] || endpointMap['gateways']?.['ok']);
            if (!accountCoreSucceeded) {
                const statuses = entries.map((item) => `${item['name']}:${item['status']}`).join(', ');
                throw new Error(`Cloudflare account import failed for all core endpoints (${statuses})`);
            }
            return {
                accountId,
                gatewayId: gatewayIdValue,
                endpoints: endpointMap,
            };
        },
        parseRows: parseCloudflareWorkersAiAccountRows,
        toEvidenceFacts() {
            return [];
        },
        toProviderEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cloudflare-workers-ai-account';
            return rows.flatMap((row) =>
                providerEvidenceValues(/** @type {Record<string, unknown>} */ (row)).map((item) =>
                    createProviderMetadataEvidence({
                        evidenceId: `${sourceId}:cloudflare-workers-ai:${item.fieldPath}`,
                        providerId: 'cloudflare-workers-ai',
                        subjectProviderId: 'cloudflare-workers-ai',
                        fieldPath: item.fieldPath,
                        value: item.value,
                        sourceId,
                        sourceKind: 'authenticated_account_api',
                        confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                        rawPayloadRef: context.rawPayloadRef,
                    }),
                ),
            );
        },
        toAccountOverlays(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'cloudflare-workers-ai-account';
            return rows.map((row) => {
                const raw = /** @type {Record<string, unknown>} */ (row);
                const modelRows = accountModels(raw);
                const gatewayRows = gateways(raw);
                const selected = selectedGateway(raw);
                const configs = providerConfigs(raw);
                const creditBalance = resultRecord(endpointBody(endpoint(raw, 'creditBalance')));
                const spendingLimit = resultRecord(endpointBody(endpoint(raw, 'spendingLimit')));
                const gateway = gatewayControls(selected);
                const spending = spendingFromLimit(spendingLimit);
                const controls = normalizeAccountOverlayControls({
                    enabledModels: modelRows.map(providerModel).filter(Boolean),
                    byokProviderKeys: configs.map(providerConfigSlug).filter(Boolean),
                    providerMetadata: {
                        semantics: 'cloudflare_account_ai_gateway_access',
                        endpoint: CLOUDFLARE_WORKERS_AI_MODELS_SEARCH_PATH,
                        gatewayEndpoint: CLOUDFLARE_AI_GATEWAY_GATEWAY_PATH,
                        providerConfigsEndpoint: CLOUDFLARE_AI_GATEWAY_PROVIDER_CONFIGS_PATH,
                        creditBalanceEndpoint: CLOUDFLARE_AI_GATEWAY_CREDIT_BALANCE_PATH,
                        spendingLimitEndpoint: CLOUDFLARE_AI_GATEWAY_SPENDING_LIMIT_PATH,
                        accountIdConfigured: Boolean(raw['accountId']),
                        gatewayIdConfigured: Boolean(raw['gatewayId']),
                        gatewayCount: gatewayRows.length,
                        gatewayIds: gatewayRows.map(gatewayId).filter(Boolean),
                        selectedGatewayFound: Boolean(selected),
                        providerConfigCount: configs.length,
                        supportsFallback: true,
                        supportsRetry: true,
                        supportsCache: true,
                        ...gateway.providerMetadata,
                        ...spending.providerMetadata,
                    },
                });
                return createProviderAccountOverlay({
                    accountOverlayId: `cloudflare-workers-ai:${raw['accountId'] ?? 'account'}:${raw['gatewayId'] ?? 'gateway'}:${sourceId}`,
                    providerId: 'cloudflare-workers-ai',
                    accountScope: stringValue(raw['accountId']) ?? 'default',
                    secretRef: options.secretRef ?? 'CLOUDFLARE_API_TOKEN',
                    sourceId,
                    sourceKind: 'authenticated_account_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    enabledModels: controls.enabledModels,
                    byokProviderKeys: controls.byokProviderKeys,
                    quota: quotaFromCreditBalance(creditBalance),
                    rateLimits: gateway.rateLimits,
                    spendingLimits: spending.spendingLimits,
                    providerMetadata: controls.providerMetadata,
                });
            });
        },
    };
}
