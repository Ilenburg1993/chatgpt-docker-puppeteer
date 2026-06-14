// @ts-check
/**
 * Kilo Gateway authenticated account importer.
 *
 * Kilo documents public model/provider catalogs and runtime error semantics, but not a stable standalone account/balance
 * endpoint. This importer therefore stays conservative: it authenticates against `/models`, decodes only non-sensitive
 * JWT claims locally, and records explicit account-policy fields only when the endpoint returns them.
 *
 * Sources checked 2026-05-26:
 * - https://kilo.ai/docs/gateway/authentication
 * - https://kilo.ai/docs/gateway/models-and-providers
 * - https://kilo.ai/docs/gateway/api-reference
 *
 * @module copilot/model-gateway/catalog/importers/kilo-gateway-account-importer
 */

import { Buffer } from 'node:buffer';

import {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    createProviderAccountOverlay,
    createProviderMetadataEvidence,
} from '../contracts.js';
import { normalizeAccountOverlayControls } from '../normalizers.js';
import { KILO_GATEWAY_MODELS_CATALOG_URL } from './kilo-gateway-models-importer.js';
import { readCatalogResponseJson } from './response-body.js';

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
 * @param {unknown} value
 * @returns {boolean | null}
 */
function booleanValue(value) {
    if (typeof value === 'boolean') return value;
    const text = stringValue(value)?.toLowerCase();
    if (text === 'true' || text === 'yes' || text === 'allowed' || text === 'enabled') return true;
    if (text === 'false' || text === 'no' || text === 'blocked' || text === 'disabled') return false;
    return null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(stringValue).filter((item) => item !== null))];
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeKiloValue(value) {
    if (Array.isArray(value)) return value.map(sanitizeKiloValue);
    if (!isRecord(value)) return value;
    /** @type {Record<string, unknown>} */
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
        if (/(?:authorization|bearer|token|secret|api[_-]?key|password|pepper|credential|private)/iu.test(key)) {
            sanitized[key] = '[REDACTED]';
            continue;
        }
        sanitized[key] = sanitizeKiloValue(entry);
    }
    return sanitized;
}

/**
 * @param {string} segment
 * @returns {Record<string, unknown> | null}
 */
function decodeJwtJsonSegment(segment) {
    try {
        const padded = segment.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
        const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * @param {string | undefined} apiKey
 * @returns {Record<string, unknown>}
 */
function decodeKiloJwtClaims(apiKey) {
    const parts = apiKey?.split('.') ?? [];
    const header = parts.length === 3 ? decodeJwtJsonSegment(parts[0] ?? '') : null;
    const payload = parts.length === 3 ? decodeJwtJsonSegment(parts[1] ?? '') : null;
    return {
        validJwtShape: parts.length === 3 && Boolean(payload),
        alg: stringValue(header?.['alg']),
        typ: stringValue(header?.['typ']),
        env: stringValue(payload?.['env']),
        kiloUserId: stringValue(payload?.['kiloUserId']),
        subject: stringValue(payload?.['sub']),
        issuer: stringValue(payload?.['iss']),
        version: finiteNumber(payload?.['version']),
        issuedAtUnix: finiteNumber(payload?.['iat']),
        expiresAtUnix: finiteNumber(payload?.['exp']),
        hasApiTokenPepper: payload ? Object.prototype.hasOwnProperty.call(payload, 'apiTokenPepper') : false,
    };
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
function modelRows(raw) {
    if (Array.isArray(raw)) return raw.filter(isRecord);
    if (!isRecord(raw)) return [];
    const body = isRecord(raw['modelsResponse']) ? raw['modelsResponse']['body'] : raw;
    if (Array.isArray(body)) return body.filter(isRecord);
    if (!isRecord(body)) return [];
    const result = isRecord(body['result']) ? body['result'] : body;
    if (Array.isArray(body['data'])) return body['data'].filter(isRecord);
    if (Array.isArray(result['data'])) return result['data'].filter(isRecord);
    if (Array.isArray(result['models'])) return result['models'].filter(isRecord);
    if (Array.isArray(result)) return result.filter(isRecord);
    return [];
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string | null}
 */
function providerModel(row) {
    return stringValue(row['id']) ?? stringValue(row['model']) ?? stringValue(row['name']);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function isFreeModel(row) {
    const id = providerModel(row) ?? '';
    return row['isFree'] === true || id.includes(':free') || id === 'openrouter/free' || id.startsWith('kilo-auto/free');
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function hasExplicitAccessField(row) {
    return [
        'allowed',
        'isAllowed',
        'available',
        'enabled',
        'canUse',
        'blocked',
        'disabled',
        'access',
        'access_status',
        'accessStatus',
        'policy',
        'policyStatus',
    ].some((field) => Object.prototype.hasOwnProperty.call(row, field));
}

/**
 * @param {Record<string, unknown>} row
 * @returns {'enabled' | 'blocked' | 'unknown'}
 */
function explicitAccess(row) {
    if (booleanValue(row['blocked']) === true || booleanValue(row['disabled']) === true) return 'blocked';
    if (
        booleanValue(row['allowed']) === true ||
        booleanValue(row['isAllowed']) === true ||
        booleanValue(row['available']) === true ||
        booleanValue(row['enabled']) === true ||
        booleanValue(row['canUse']) === true
    ) {
        return 'enabled';
    }
    const status = (
        stringValue(row['access']) ??
        stringValue(row['access_status']) ??
        stringValue(row['accessStatus']) ??
        stringValue(row['policyStatus'])
    )?.toLowerCase();
    if (!status) return 'unknown';
    if (['allowed', 'available', 'enabled', 'included', 'active'].includes(status)) return 'enabled';
    if (['blocked', 'forbidden', 'disabled', 'denied', 'not_allowed', 'not-allowed'].includes(status)) return 'blocked';
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
function accountRecord(raw) {
    const modelsResponse = isRecord(raw['modelsResponse']) ? raw['modelsResponse'] : {};
    const body = isRecord(modelsResponse['body']) ? modelsResponse['body'] : {};
    const candidates = [
        raw['account'],
        raw['organization'],
        raw['billing'],
        body['account'],
        body['organization'],
        body['billing'],
        body['limits'],
        isRecord(body['result']) ? body['result']['account'] : null,
        isRecord(body['result']) ? body['result']['organization'] : null,
        isRecord(body['result']) ? body['result']['billing'] : null,
    ];
    return candidates.find(isRecord) ?? {};
}

/**
 * @param {Record<string, unknown>} account
 * @returns {number | null}
 */
function remainingCredits(account) {
    return (
        finiteNumber(account['remainingCreditsUsd']) ??
        finiteNumber(account['remainingCredits']) ??
        finiteNumber(account['remaining_credits']) ??
        finiteNumber(account['creditBalance']) ??
        finiteNumber(account['balance']) ??
        finiteNumber(account['credits'])
    );
}

/**
 * @param {Record<string, unknown>} account
 * @returns {string[]}
 */
function byokProviderKeys(account) {
    return [
        ...stringList(account['byokProviderKeys']),
        ...stringList(account['providerKeys']),
        ...stringList(account['configuredProviders']),
        ...stringList(account['enabledProviders']),
    ];
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>[]}
 */
export function parseKiloGatewayAccountRows(raw) {
    return isRecord(raw) ? [raw] : [];
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Array<{ fieldPath: string; value: unknown }>}
 */
function providerEvidenceValues(raw) {
    const token = isRecord(raw['tokenClaims']) ? raw['tokenClaims'] : {};
    const rows = modelRows(raw);
    const account = accountRecord(raw);
    const explicitRows = rows.filter(hasExplicitAccessField);
    const enabled = rows.filter((row) => explicitAccess(row) === 'enabled').map(providerModel).filter(Boolean);
    const blocked = rows.filter((row) => explicitAccess(row) === 'blocked').map(providerModel).filter(Boolean);
    return [
        { fieldPath: 'providerMetadata.kilo.accountApi.authenticatedModelsStatus', value: raw['modelsStatus'] },
        { fieldPath: 'providerMetadata.kilo.accountApi.visibleModelCount', value: rows.length },
        { fieldPath: 'providerMetadata.kilo.accountApi.freeModelCount', value: rows.filter(isFreeModel).length },
        { fieldPath: 'providerMetadata.kilo.accountApi.explicitAccessFieldCount', value: explicitRows.length },
        { fieldPath: 'providerMetadata.kilo.accountApi.explicitEnabledModels', value: enabled },
        { fieldPath: 'providerMetadata.kilo.accountApi.explicitBlockedModels', value: blocked },
        { fieldPath: 'providerMetadata.kilo.accountApi.byokProviderKeys', value: byokProviderKeys(account) },
        { fieldPath: 'providerMetadata.kilo.accountApi.remainingCreditsUsd', value: remainingCredits(account) },
        { fieldPath: 'providerMetadata.kilo.token.validJwtShape', value: token['validJwtShape'] },
        { fieldPath: 'providerMetadata.kilo.token.env', value: token['env'] },
        { fieldPath: 'providerMetadata.kilo.token.version', value: token['version'] },
        { fieldPath: 'providerMetadata.kilo.token.expiresAtUnix', value: token['expiresAtUnix'] },
    ].filter((item) => {
        if (item.value === null || item.value === undefined) return false;
        if (Array.isArray(item.value) && item.value.length === 0) return false;
        return true;
    });
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.apiKey]
 * @param {string} [options.secretRef]
 * @param {string} [options.organizationId]
 * @param {string} [options.organizationIdRef]
 * @param {string} [options.url]
 * @returns {import('../importer-runner.js').CatalogImporter}
 */
export function createKiloGatewayAccountImporter(options = {}) {
    const url = options.url ?? KILO_GATEWAY_MODELS_CATALOG_URL;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    return {
        id: 'kilo-gateway-account',
        providerId: 'kilo',
        sourceKind: 'authenticated_account_api',
        requiresAuth: true,
        url,
        envRequirements: ['KILO_API_KEY', 'KILO_CODE_API_KEY', 'KILOCODE_API_KEY', 'KILO_ORGANIZATION_ID'],
        refreshPolicy: 'manual',
        ttlSeconds: 900,
        async fetchRaw() {
            if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for Kilo Gateway account import');
            if (!options.apiKey) throw new Error('KILO_API_KEY or KILO_CODE_API_KEY is required for Kilo Gateway account import');
            const headers = {
                accept: 'application/json',
                authorization: `Bearer ${options.apiKey}`,
                ...(options.organizationId ? { 'X-KiloCode-OrganizationId': options.organizationId } : {}),
            };
            const response = await fetchImpl(url, { headers });
            /** @type {unknown} */
            let body;
            try {
                body = await readCatalogResponseJson(response, { label: 'Kilo Gateway account' });
            } catch (error) {
                body = { parseError: error instanceof Error ? error.message : 'unknown response parse error' };
            }
            if (!response.ok) throw new Error(`Kilo Gateway authenticated models fetch failed with HTTP ${response.status}`);
            return {
                tokenClaims: decodeKiloJwtClaims(options.apiKey),
                organizationIdConfigured: Boolean(options.organizationId),
                organizationIdRef: options.organizationIdRef,
                modelsStatus: response.status,
                modelsResponse: {
                    url,
                    body: sanitizeKiloValue(body),
                },
            };
        },
        parseRows: parseKiloGatewayAccountRows,
        toEvidenceFacts() {
            return [];
        },
        toProviderEvidenceFacts(rows, context) {
            const sourceId = stringValue(context.source['id']) ?? 'kilo-gateway-account';
            return rows.flatMap((row) =>
                providerEvidenceValues(/** @type {Record<string, unknown>} */ (row)).map((item) =>
                    createProviderMetadataEvidence({
                        evidenceId: `${sourceId}:kilo:${item.fieldPath}`,
                        providerId: 'kilo',
                        subjectProviderId: 'kilo',
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
            const sourceId = stringValue(context.source['id']) ?? 'kilo-gateway-account';
            return rows.map((row) => {
                const raw = /** @type {Record<string, unknown>} */ (row);
                const token = isRecord(raw['tokenClaims']) ? raw['tokenClaims'] : {};
                const account = accountRecord(raw);
                const rowsForAccount = modelRows(raw);
                const explicitlyEnabled = rowsForAccount
                    .filter((model) => explicitAccess(model) === 'enabled')
                    .map(providerModel)
                    .filter(Boolean);
                const freeEnabled = rowsForAccount.filter(isFreeModel).map(providerModel).filter(Boolean);
                const blocked = rowsForAccount
                    .filter((model) => explicitAccess(model) === 'blocked')
                    .map(providerModel)
                    .filter(Boolean);
                const credits = remainingCredits(account);
                const controls = normalizeAccountOverlayControls({
                    enabledModels: [...new Set([...explicitlyEnabled, ...freeEnabled])],
                    blockedModels: blocked,
                    byokProviderKeys: byokProviderKeys(account),
                    providerMetadata: {
                        semantics: 'kilo_authenticated_models_and_token_claims',
                        authenticatedModelsEndpoint: '/api/gateway/models',
                        accountEndpointDocumented: false,
                        accountPolicySource: 'authenticated_models_response_if_present',
                        tokenClaimsSource: 'local_jwt_decode_without_signature_verification',
                        organizationIdConfigured: Boolean(raw['organizationIdConfigured']),
                        organizationIdRef: stringValue(raw['organizationIdRef']),
                        visibleModelCount: rowsForAccount.length,
                        freeModelCount: rowsForAccount.filter(isFreeModel).length,
                        explicitAccessFieldCount: rowsForAccount.filter(hasExplicitAccessField).length,
                        tokenEnv: stringValue(token['env']),
                        tokenVersion: finiteNumber(token['version']),
                        tokenExpiresAtUnix: finiteNumber(token['expiresAtUnix']),
                        tokenHasPepperClaim: token['hasApiTokenPepper'] === true,
                    },
                });
                const accountScope =
                    stringValue(token['kiloUserId']) ??
                    stringValue(token['subject']) ??
                    stringValue(raw['organizationIdRef']) ??
                    'default';
                return createProviderAccountOverlay({
                    accountOverlayId: `kilo:${accountScope}:${options.secretRef ?? 'KILO_API_KEY'}:${sourceId}`,
                    providerId: 'kilo',
                    accountScope,
                    secretRef: options.secretRef ?? 'KILO_API_KEY',
                    organizationIdRef: options.organizationIdRef,
                    sourceId,
                    sourceKind: 'authenticated_account_api',
                    confidence: MODEL_GATEWAY_CATALOG_CONFIDENCE.AUTHENTICATED_CATALOG,
                    enabledModels: controls.enabledModels,
                    blockedModels: controls.blockedModels,
                    byokProviderKeys: controls.byokProviderKeys,
                    quota: {
                        ...(typeof credits === 'number' ? { remainingCreditsUsd: credits } : {}),
                    },
                    providerMetadata: controls.providerMetadata,
                });
            });
        },
    };
}
