// @ts-check - Type checking rigoroso habilitado (arquivo core)

/**
 * @typedef {'required'|'optional'} RuntimeResourceCriticality
 * @typedef {'ready'|'degraded'|'not-ready'|'stopped'|'unknown'} RuntimeResourceState
 * @typedef {{
 *   id: string,
 *   owner: string,
 *   criticality: RuntimeResourceCriticality,
 *   state: RuntimeResourceState,
 *   reasonCode: string|null,
 *   message: string|null,
 *   updatedAt: number,
 *   stop?: (() => Promise<void>|void)|null,
 *   health?: (() => unknown)|null
 * }} RuntimeResource
 */

/** @type {Map<string, RuntimeResource>} */
const runtimeResources = new Map();

function now() {
    return Date.now();
}

/**
 * @param {unknown} value
 * @returns {RuntimeResourceCriticality}
 */
function normalizeCriticality(value) {
    return value === 'required' ? 'required' : 'optional';
}

/**
 * @param {unknown} value
 * @returns {RuntimeResourceState}
 */
function normalizeState(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'ready') return 'ready';
    if (normalized === 'degraded') return 'degraded';
    if (normalized === 'not-ready') return 'not-ready';
    if (normalized === 'stopped') return 'stopped';
    return 'unknown';
}

/**
 * Executa uma operação assíncrona com timeout cancelável.
 * Evita Promise.race com timer órfão sem clearTimeout no mesmo escopo.
 *
 * @template T
 * @param {() => Promise<T>|T} operation
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function runWithTimeout(operation, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        Promise.resolve()
            .then(() => operation())
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

/**
 * @param {Partial<RuntimeResource> & {id: string}} resource
 * @param {*} resource
 * @returns {RuntimeResource}
 */
function upsertRuntimeResource(resource) {
    const id = String(resource?.id || '').trim();
    if (!id) {
        throw new Error('runtime resource id is required');
    }

    const existing = runtimeResources.get(id);
    /** @type {RuntimeResource} */
    const next = {
        id,
        owner: String(resource?.owner || existing?.owner || 'unknown'),
        criticality: normalizeCriticality(resource?.criticality || existing?.criticality || 'optional'),
        state: normalizeState(resource?.state || existing?.state || 'unknown'),
        reasonCode: resource?.reasonCode ?? existing?.reasonCode ?? null,
        message: resource?.message ?? existing?.message ?? null,
        updatedAt: now(),
        stop: typeof resource?.stop === 'function' ? resource.stop : (existing?.stop ?? null),
        health: typeof resource?.health === 'function' ? resource.health : (existing?.health ?? null),
    };

    runtimeResources.set(id, next);
    return next;
}

/**
 * @typedef {object} SetRuntimeResourceStateDetails
 * @property {string} [owner] - Proprietário do recurso
 * @property {string} [criticality] - Criticidade do recurso
 * @property {string} [reasonCode] - Código de motivo da mudança
 * @property {string} [message] - Mensagem descritiva
 * @property {boolean} [stop] - Se verdadeiro, o recurso deve parar
 * @property {string} [health] - Estado de saúde do recurso
 */
/**
 * @param {string} id
 * @param {RuntimeResourceState} state
 * @param {SetRuntimeResourceStateDetails} [details]
 * @returns {void}
 */
function setRuntimeResourceState(id, state, details = {}) {
    return upsertRuntimeResource({
        id,
        owner: details.owner,
        criticality: details.criticality,
        state,
        reasonCode: details.reasonCode,
        message: details.message,
        stop: details.stop,
        health: details.health,
    });
}

/**
 * @typedef {object} GetRuntimeResourcesSnapshotOptions
 * @property {string|null} owner
 */
/**
 * Retorna snapshot serializável dos recursos runtime registrados.
 *
 * @param {GetRuntimeResourcesSnapshotOptions} [options]
 * @returns {Array<{id:string, owner:string, criticality:RuntimeResourceCriticality, state:RuntimeResourceState, reasonCode:string|null, message:string|null, updatedAt:number, health:unknown}>}
 */
function getRuntimeResourcesSnapshot({ owner = null } = {}) {
    const values = [...runtimeResources.values()]
        .filter(item => !owner || item.owner === owner)
        .map(item => {
            let health = null;
            if (typeof item.health === 'function') {
                try {
                    health = item.health();
                } catch (error) {
                    health = { error: error?.message || String(error) };
                }
            }
            return {
                id: item.id,
                owner: item.owner,
                criticality: item.criticality,
                state: item.state,
                reasonCode: item.reasonCode,
                message: item.message,
                updatedAt: item.updatedAt,
                health,
            };
        });
    return values;
}

/**
 * @typedef {object} GetRuntimeReadinessSummaryOptions
 * @property {string|null} owner
 * @property {string[]} requiredComponents
 * @property {boolean} allowDegradedReady
 */
/**
 * Consolida readiness/degraded/not-ready a partir do registry de recursos runtime.
 *
 * @param {GetRuntimeReadinessSummaryOptions} [options]
 * @returns {{
 *   status: 'ready'|'degraded'|'not-ready',
 *   required_components: Array<{id:string,state:string,reasonCode:string|null,message:string|null}>,
 *   degraded_components: Array<{id:string,state:string,reasonCode:string|null,message:string|null}>,
 *   not_ready_components: Array<{id:string,state:string,reasonCode:string|null,message:string|null}>,
 *   resources: ReturnType<typeof getRuntimeResourcesSnapshot>,
 * }}
 */
function getRuntimeReadinessSummary({ owner = null, requiredComponents = [], allowDegradedReady = true } = {}) {
    const resources = getRuntimeResourcesSnapshot({ owner });
    const explicitRequired = new Set(requiredComponents || []);
    const required = [];
    const degraded = [];
    const notReady = [];

    for (const resource of resources) {
        const isRequired = explicitRequired.has(resource.id) || resource.criticality === 'required';
        const summary = {
            id: resource.id,
            state: resource.state,
            reasonCode: resource.reasonCode,
            message: resource.message,
        };

        if (isRequired) {
            required.push(summary);
        }

        if (resource.state === 'degraded') {
            degraded.push(summary);
        } else if (resource.state === 'not-ready') {
            notReady.push(summary);
        }
    }

    const requiredNotReady = required.filter(item => item.state !== 'ready');
    const status =
        requiredNotReady.length > 0
            ? 'not-ready'
            : degraded.length > 0 && !allowDegradedReady
              ? 'not-ready'
              : degraded.length > 0
                ? 'degraded'
                : 'ready';

    return {
        status,
        required_components: required,
        degraded_components: degraded,
        not_ready_components: notReady,
        resources,
    };
}

/**
 * @typedef {object} StopRuntimeResourcesOptions
 * @property {string|null} owner
 * @property {number} timeoutMs
 * @property {((level: string} logger
 * @property {string) => void)|null} message
 */
/**
 * Para recursos registrados em ordem reversa de criação, com timeout por recurso.
 *
 * @param {StopRuntimeResourcesOptions} [options]
 * @returns {Promise<Array<{id:string, ok:boolean, error?:string, timeout?:boolean}>>}
 */
async function stopRuntimeResources({ owner = null, timeoutMs = 5000, logger = null } = {}) {
    const entries = [...runtimeResources.values()].filter(item => !owner || item.owner === owner);
    entries.reverse();

    /** @type {Array<{id:string, ok:boolean, error?:string, timeout?:boolean}>} */
    const results = [];

    for (const resource of entries) {
        if (typeof resource.stop !== 'function') {
            continue;
        }

        try {
            await runWithTimeout(() => Promise.resolve(resource.stop()), timeoutMs);
            setRuntimeResourceState(resource.id, 'stopped', {
                owner: resource.owner,
                criticality: resource.criticality,
            });
            results.push({ id: resource.id, ok: true });
        } catch (error) {
            setRuntimeResourceState(resource.id, 'degraded', {
                owner: resource.owner,
                criticality: resource.criticality,
                reasonCode: 'RESOURCE_SHUTDOWN_FAILED',
                message: error?.message || String(error),
            });
            results.push({
                id: resource.id,
                ok: false,
                timeout: /timeout/i.test(error?.message || ''),
                error: error?.message || String(error),
            });
            if (logger && typeof logger === 'function') {
                logger(
                    'WARN',
                    `[RUNTIME_REGISTRY] Falha ao parar recurso ${resource.id}: ${error?.message || String(error)}`
                );
            }
        }
    }

    return results;
}

/**
 * Remove recursos do registry (todos ou apenas de um owner).
 *
 * @param {string|null} [owner=null]
 * @returns {void}
 */
function clearRuntimeResources(owner = null) {
    if (!owner) {
        runtimeResources.clear();
        return;
    }
    for (const [id, resource] of runtimeResources.entries()) {
        if (resource.owner === owner) {
            runtimeResources.delete(id);
        }
    }
}

export {
    clearRuntimeResources,
    getRuntimeReadinessSummary,
    getRuntimeResourcesSnapshot,
    setRuntimeResourceState,
    stopRuntimeResources,
    upsertRuntimeResource,
};
