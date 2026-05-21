// @ts-check
/**
 * Current-process operational health for BYOK provider/model pairs.
 *
 * The model catalog says "the provider lists this model"; this state says "a real chat turn using this provider/model
 * recently worked or failed". It is intentionally fed by runtime events, not by another discovery path.
 *
 * @module copilot/terminal/state/byok-provider-health
 */

const MAX_BYOK_PROVIDER_HEALTH_RECORDS = 200;

/** @type {Map<string, { key: string; profile: string | null; provider: string | null; model: string | null; lastStatus: 'failed' | 'ok'; failureCount: number; successCount: number; lastFailureAt: number | null; lastSuccessAt: number | null; lastMessage: string | null; lastErrorContext: string | null }>} */
const _byokProviderHealthByKey = new Map();

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizePart(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null }} input
 * @returns {string}
 */
function healthKey(input) {
    return [normalizePart(input.profile) ?? '-', normalizePart(input.provider) ?? '-', normalizePart(input.model) ?? '-']
        .join('|')
        .toLowerCase();
}

function pruneByokProviderHealth() {
    while (_byokProviderHealthByKey.size > MAX_BYOK_PROVIDER_HEALTH_RECORDS) {
        const firstKey = _byokProviderHealthByKey.keys().next().value;
        if (!firstKey) break;
        _byokProviderHealthByKey.delete(firstKey);
    }
}

/**
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null; message?: string | null; errorContext?: string | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelCallFailure(input) {
    const profile = normalizePart(input.profile);
    const provider = normalizePart(input.provider);
    const model = normalizePart(input.model);
    if (!profile && !provider && !model) return;
    const key = healthKey({ profile, provider, model });
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    _byokProviderHealthByKey.set(key, {
        key,
        profile,
        provider,
        model,
        lastStatus: 'failed',
        failureCount: (previous?.failureCount ?? 0) + 1,
        successCount: previous?.successCount ?? 0,
        lastFailureAt: now,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastMessage: normalizePart(input.message) ?? previous?.lastMessage ?? null,
        lastErrorContext: normalizePart(input.errorContext) ?? previous?.lastErrorContext ?? null,
    });
    pruneByokProviderHealth();
}

/**
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null; timestamp?: number }} input
 * @returns {void}
 */
export function recordByokProviderModelCallSuccess(input) {
    const profile = normalizePart(input.profile);
    const provider = normalizePart(input.provider);
    const model = normalizePart(input.model);
    if (!profile && !provider && !model) return;
    const key = healthKey({ profile, provider, model });
    const now = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : Date.now();
    const previous = _byokProviderHealthByKey.get(key);
    _byokProviderHealthByKey.set(key, {
        key,
        profile,
        provider,
        model,
        lastStatus: 'ok',
        failureCount: previous?.failureCount ?? 0,
        successCount: (previous?.successCount ?? 0) + 1,
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastSuccessAt: now,
        lastMessage: null,
        lastErrorContext: null,
    });
    pruneByokProviderHealth();
}

/**
 * @param {{ profile?: string | null; provider?: string | null; model?: string | null }} input
 * @returns {{ key: string; profile: string | null; provider: string | null; model: string | null; lastStatus: 'failed' | 'ok'; failureCount: number; successCount: number; lastFailureAt: number | null; lastSuccessAt: number | null; lastMessage: string | null; lastErrorContext: string | null } | null}
 */
export function readByokProviderModelHealth(input) {
    return _byokProviderHealthByKey.get(healthKey(input)) ?? null;
}

/**
 * @returns {Array<{ key: string; profile: string | null; provider: string | null; model: string | null; lastStatus: 'failed' | 'ok'; failureCount: number; successCount: number; lastFailureAt: number | null; lastSuccessAt: number | null; lastMessage: string | null; lastErrorContext: string | null }>}
 */
export function listByokProviderModelHealth() {
    return [..._byokProviderHealthByKey.values()].sort((a, b) => {
        const aTime = Math.max(a.lastFailureAt ?? 0, a.lastSuccessAt ?? 0);
        const bTime = Math.max(b.lastFailureAt ?? 0, b.lastSuccessAt ?? 0);
        return bTime - aTime;
    });
}

/**
 * @returns {void}
 */
export function clearByokProviderModelHealth() {
    _byokProviderHealthByKey.clear();
}
