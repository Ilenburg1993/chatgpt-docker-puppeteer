// @ts-check

/**
 * Resolve whether a disposable probe actually crossed the provider-call boundary.
 *
 * Modern probes set `providerAttempted` exactly at the `sendSessionAndWait` boundary. The status fallback exists only
 * for older persisted/test shapes and intentionally treats preflight/unavailable results as not attempted.
 *
 * @param {Record<string, unknown> | null | undefined} probe
 * @returns {boolean}
 */
export function didConfiguredByokProbeAttemptProvider(probe) {
    if (!probe || typeof probe !== 'object') return false;
    if (typeof probe['providerAttempted'] === 'boolean') return probe['providerAttempted'];
    const status = String(probe['status'] ?? '')
        .trim()
        .toLowerCase();
    return status !== '' && status !== 'unavailable' && status !== 'admission-blocked';
}

/**
 * Describe the failure scope without misattributing an SDK/session bootstrap failure to the selected BYOK provider.
 *
 * @param {Record<string, unknown> | null | undefined} probe
 * @returns {'provider' | 'controller_substrate' | 'preflight' | null}
 */
export function classifyConfiguredByokProbeFailureScope(probe) {
    if (!probe || typeof probe !== 'object' || probe['ok'] === true) return null;
    if (didConfiguredByokProbeAttemptProvider(probe)) return 'provider';
    const status = String(probe['status'] ?? '')
        .trim()
        .toLowerCase();
    if (status === 'failed') return 'controller_substrate';
    return 'preflight';
}
