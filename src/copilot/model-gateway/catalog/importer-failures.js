// @ts-check
/**
 * Catalog importer failure taxonomy.
 *
 * Importer failures happen before runtime: a public metadata source may be unavailable, a local daemon may be offline,
 * or an account-scoped key may be expired. This helper reuses the BYOK provider failure taxonomy and adds the build
 * decision layer needed by metadata database materialization.
 *
 * @module copilot/model-gateway/catalog/importer-failures
 */

import { classifyByokProviderFailure } from '../health/provider-failure.js';

export const MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION = Object.freeze({
    BLOCKING_METADATA_SOURCE: 'blocking_metadata_source',
    ACCOUNT_STATE_UNAVAILABLE: 'account_state_unavailable',
    OPTIONAL_LOCAL_SOURCE_UNAVAILABLE: 'optional_local_source_unavailable',
    ALLOWED_BY_OPERATOR: 'allowed_by_operator',
});

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(optionalString).filter((item) => item !== null);
}

/**
 * @param {string | null} sourceKind
 * @param {boolean} requiresAuth
 * @returns {boolean}
 */
function isAccountScopedSource(sourceKind, requiresAuth) {
    return requiresAuth || /^(?:authenticated_api|authenticated_account_api)$/u.test(sourceKind ?? '');
}

/**
 * @param {string | null} sourceKind
 * @returns {boolean}
 */
function isLocalDaemonSource(sourceKind) {
    return sourceKind === 'local_daemon';
}

/**
 * @param {object} input
 * @param {string} [input.importerId]
 * @param {string} [input.providerId]
 * @param {string} [input.sourceId]
 * @param {string} [input.sourceKind]
 * @param {boolean} [input.requiresAuth]
 * @param {unknown[]} [input.errors]
 * @param {unknown} [input.message]
 * @param {object} [options]
 * @param {boolean} [options.allowAllImporterFailures]
 * @param {boolean} [options.failOnAccountImporterFailures]
 * @param {boolean} [options.failOnLocalImporterFailures]
 * @returns {{
 *   importerId: string | null;
 *   providerId: string | null;
 *   sourceId: string | null;
 *   sourceKind: string | null;
 *   requiresAuth: boolean;
 *   errors: string[];
 *   failureKind: string;
 *   statusCode: number | null;
 *   errorContext: string;
 *   buildBlocking: boolean;
 *   disposition: string;
 *   operatorLabel: string;
 *   operatorAction: string;
 * }}
 */
export function classifyModelGatewayCatalogImporterFailure(input, options = {}) {
    const sourceKind = optionalString(input.sourceKind);
    const requiresAuth = input.requiresAuth === true;
    const errors = stringList(input.errors);
    const providerFailure = classifyByokProviderFailure({
        message: errors.join('; ') || optionalString(input.message) || 'catalog importer failed',
    });
    const accountScoped = isAccountScopedSource(sourceKind, requiresAuth);
    const localDaemon = isLocalDaemonSource(sourceKind);
    const allowed = options.allowAllImporterFailures === true;
    const accountFailureNonBlocking = accountScoped && options.failOnAccountImporterFailures !== true;
    const localFailureNonBlocking = localDaemon && options.failOnLocalImporterFailures !== true;
    const disposition = allowed
        ? MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.ALLOWED_BY_OPERATOR
        : localFailureNonBlocking
          ? MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.OPTIONAL_LOCAL_SOURCE_UNAVAILABLE
          : accountFailureNonBlocking
            ? MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.ACCOUNT_STATE_UNAVAILABLE
            : MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.BLOCKING_METADATA_SOURCE;
    return {
        importerId: optionalString(input.importerId),
        providerId: optionalString(input.providerId),
        sourceId: optionalString(input.sourceId),
        sourceKind,
        requiresAuth,
        errors,
        failureKind: providerFailure.kind,
        statusCode: providerFailure.statusCode,
        errorContext: providerFailure.errorContext,
        buildBlocking: disposition === MODEL_GATEWAY_CATALOG_IMPORTER_FAILURE_DISPOSITION.BLOCKING_METADATA_SOURCE,
        disposition,
        operatorLabel: providerFailure.operatorLabel,
        operatorAction: providerFailure.operatorAction,
    };
}

