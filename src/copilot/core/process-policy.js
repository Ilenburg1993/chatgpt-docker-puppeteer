// @ts-check
/**
 * Process-owned configuration for Core facilities that are intrinsically process-scoped but must remain L0.
 *
 * Core never reads process.env. A composition root projects one immutable policy from an explicit environment snapshot,
 * activates it with an unforgeable-by-convention owner token, and Core consumers either capture that policy at instance
 * creation or read one stable snapshot at operation entry. Standalone callers receive conservative deterministic
 * defaults.
 *
 * @module copilot/core/process-policy
 */

const DEFAULT_EVENT_BUS_MAX_COUNTERS = 1_000;

/**
 * @typedef {Readonly<{
 *   eventBus: Readonly<{maxCounters:number}>;
 *   urlSecurity: Readonly<{allowPrivateWebhookHosts:boolean}>;
 * }>} CoreProcessPolicyConfig
 */

/**
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 * @returns {CoreProcessPolicyConfig}
 */
export function readCoreProcessPolicyConfig(env = {}) {
    const configuredMaxCounters = Number(env['COPILOT_EVENT_BUS_MAX_COUNTERS'] ?? DEFAULT_EVENT_BUS_MAX_COUNTERS);
    const maxCounters = Number.isFinite(configuredMaxCounters)
        ? Math.max(1, Math.trunc(configuredMaxCounters))
        : DEFAULT_EVENT_BUS_MAX_COUNTERS;
    return Object.freeze({
        eventBus: Object.freeze({ maxCounters }),
        urlSecurity: Object.freeze({ allowPrivateWebhookHosts: env['WEBHOOK_ALLOW_PRIVATE_HOSTS'] === 'true' }),
    });
}

const DEFAULT_CORE_PROCESS_POLICY = readCoreProcessPolicyConfig({});

/** @type {{token:object;processId:string;config:CoreProcessPolicyConfig} | null} */
let activeCoreProcessPolicyOwner = null;

/**
 * @param {{token:object;processId:string;config:CoreProcessPolicyConfig}} owner
 * @returns {() => void}
 */
export function activateCoreProcessPolicy(owner) {
    if (!owner?.token || typeof owner.token !== 'object')
        throw new TypeError('Core process policy owner requires token.');
    const processId = String(owner.processId ?? '').trim();
    if (!processId) throw new TypeError('Core process policy owner requires processId.');
    if (activeCoreProcessPolicyOwner && activeCoreProcessPolicyOwner.token !== owner.token) {
        const error = /** @type {Error & {code?:string}} */ (
            new Error(`Core process policy is already owned by ${activeCoreProcessPolicyOwner.processId}.`)
        );
        error.code = 'ERR_CORE_PROCESS_POLICY_OWNER_ACTIVE';
        throw error;
    }
    const config = readCoreProcessPolicyConfig({
        COPILOT_EVENT_BUS_MAX_COUNTERS: String(owner.config?.eventBus.maxCounters ?? ''),
        WEBHOOK_ALLOW_PRIVATE_HOSTS: owner.config?.urlSecurity.allowPrivateWebhookHosts ? 'true' : 'false',
    });
    activeCoreProcessPolicyOwner = Object.freeze({ token: owner.token, processId, config });
    return () => {
        if (activeCoreProcessPolicyOwner?.token === owner.token) activeCoreProcessPolicyOwner = null;
    };
}

/** @returns {CoreProcessPolicyConfig} */
export function getCoreProcessPolicyConfig() {
    return activeCoreProcessPolicyOwner?.config ?? DEFAULT_CORE_PROCESS_POLICY;
}

export function getCoreProcessPolicySnapshot() {
    return Object.freeze({
        active: activeCoreProcessPolicyOwner !== null,
        processId: activeCoreProcessPolicyOwner?.processId ?? null,
        config: getCoreProcessPolicyConfig(),
    });
}
