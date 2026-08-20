// @ts-check
/**
 * OpenRouter authenticated key/account importer.
 *
 * This importer does not execute a model. It calls OpenRouter's key endpoint to collect account-scoped credit and rate
 * metadata, which can exclude impossible routes before runtime when a key is exhausted or capped.
 *
 * Source checked 2026-05-26:
 * - https://openrouter.ai/docs/api-reference/limits
 *
 * @module copilot/model-gateway/catalog/importers/openrouter-key-account-importer
 */

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createProviderAccountOverlay,
    createProviderMetadataEvidence,
} from '../contracts.js';
import { readCatalogResponseJson } from './response-body.js';

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

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
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
export function parseOpenRouterKeyRows(raw) {
    const record = isRecord(raw) ? raw : {};
    const data = isRecord(record['data']) ? record['data'] : record;
    return [data].filter(isRecord);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function providerEvidenceValues(row) {
    const rateLimit = isRecord(row['rate_limit']) ? row['rate_limit'] : {};
    return [
        { fieldPath: 'providerMetadata.openrouter.keyLabel', value: stringValue(row['label']) },
        { fieldPath: 'providerMetadata.openrouter.keyUsage', value: finiteNumber(row['usage']) },
        { fieldPath: 'providerMetadata.openrouter.keyLimit', value: finiteNumber(row['limit']) },
        { fieldPath: 'providerMetadata.openrouter.keyDisabled', value: row['disabled'] },
        { fieldPath: 'providerMetadata.openrouter.freeTier', value: row['is_free_tier'] },
        { fieldPath: 'providerMetadata.openrouter.rateLimit', value: rateLimit },
    ].filter((item) => item.value !== null && item.value !== undefined && !(isRecord(item.value) && Object.keys(item.value).length === 0));
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ limitUsd?: number; usageUsd?: number; remainingUsd?: number; unlimited?: boolean }}
 */
function spendingLimits(row) {
    const usage = finiteNumber(row['usage']);
    const limit = finiteNumber(row['limit']);
    const unlimited = row['limit'] === null || row['limit'] === undefined;
    return {
        ...(typeof limit === 'number' ? { limitUsd: limit } : {}),
        ...(typeof usage === 'number' ? { usageUsd: usage } : {}),
        ...(typeof limit === 'number' && typeof usage === 'number' ? { remainingUsd: Math.max(0, limit - usage) } : {}),
        ...(unlimited ? { unlimited: true } : {}),
    };
}

/**
 * @param {object} [options]
 * @param {import('./http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.accountScope]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createOpenRouterKeyAccountImporter(options = {}) {
    const url = options.url ?? OPENROUTER_KEY_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'openrouter-key-account',
        providerId: 'openrouter',
        sourceKind: 'authenticated_account_api',
        requiresAuth: true,
        url,
        envRequirements: ['OPENROUTER_API_KEY', 'OPEN_ROUTER_KEY'],
        refreshPolicy: 'manual',
        ttlSeconds: 900,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for OpenRouter key import');
            if (!options.apiKey) throw new Error('OPENROUTER_API_KEY is required for OpenRouter key import');
            const response = await fetchImpl(url, {
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${options.apiKey}`,
                },
            });
            if (!response.ok) throw new Error(`OpenRouter key fetch failed with HTTP ${response.status}`);
            return readCatalogResponseJson(response, { label: 'OpenRouter key account' });
        },
        parseRows: parseOpenRouterKeyRows,
        toEvidenceFacts() {
            return [];
        },
        toProviderEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'openrouter-key-account';
            return rows.flatMap((row) =>
                providerEvidenceValues(/** @type {Record<string, unknown>} */ (row)).map((item) =>
                    createProviderMetadataEvidence({
                        evidenceId: `${sourceId}:openrouter:${item.fieldPath}`,
                        providerId: 'openrouter',
                        subjectProviderId: 'openrouter',
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
            const sourceId = stringValue(context.source['id']) ?? 'openrouter-key-account';
            return rows.map((row) => {
                const record = /** @type {Record<string, unknown>} */ (row);
                const rateLimit = isRecord(record['rate_limit']) ? record['rate_limit'] : {};
                const spending = spendingLimits(record);
                return createProviderAccountOverlay({
                    accountOverlayId: `openrouter:${options.accountScope ?? 'default'}:${options.secretRef ?? 'OPENROUTER_API_KEY'}:${sourceId}`,
                    providerId: 'openrouter',
                    accountScope: options.accountScope ?? 'default',
                    secretRef: options.secretRef ?? 'OPENROUTER_API_KEY',
                    sourceId,
                    sourceKind: 'authenticated_account_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    quota: {
                        ...(typeof spending.remainingUsd === 'number' ? { remainingCreditsUsd: spending.remainingUsd } : {}),
                    },
                    spendingLimits: spending,
                    rateLimits: rateLimit,
                    providerMetadata: {
                        endpoint: '/api/v1/key',
                        semantics: 'account_key_credit_and_rate_limits',
                        keyLabel: stringValue(record['label']),
                        disabled: record['disabled'] === true,
                        freeTier: record['is_free_tier'] === true,
                    },
                });
            });
        },
    };
}
