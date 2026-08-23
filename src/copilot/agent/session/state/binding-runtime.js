// @ts-check
/**
 * Runtime-scoped binding between the Conversation Hub identity and the active SDK session identity.
 *
 * This object deliberately has no module-global state. Every AgentContext owns one instance, so multiple runtimes can
 * coexist in a process without sharing or clearing each other's session identity.
 * @module copilot/agent/session/state/binding-runtime
 */

/** @typedef {{ hubSessionId:string|null; sdkSessionId:string|null; revision:number; disposed:boolean }} AgentSessionBindingSnapshot */

/** @param {{hubSessionId?:string|null;sdkSessionId?:string|null}} [initial] */
export function createAgentSessionBindingRuntime(initial = {}) {
    let hubSessionId = normalizeId(initial.hubSessionId);
    let sdkSessionId = normalizeId(initial.sdkSessionId);
    let revision = 0;
    let disposed = false;

    function assertActive() {
        if (disposed) throw new Error('AgentSessionBindingRuntime is disposed.');
    }
    /** @param {string|null|undefined} value */
    function setHub(value) {
        assertActive();
        const next = normalizeId(value);
        if (next === hubSessionId) return api.snapshot();
        hubSessionId = next;
        revision += 1;
        return api.snapshot();
    }
    /** @param {string|null|undefined} value */
    function setSdk(value) {
        assertActive();
        const next = normalizeId(value);
        if (next === sdkSessionId) return api.snapshot();
        sdkSessionId = next;
        revision += 1;
        return api.snapshot();
    }
    const api = Object.freeze({
        setHubSessionId: setHub,
        setSdkSessionId: setSdk,
        /** @param {{hubSessionId?:string|null;sdkSessionId?:string|null}} next */
        bind(next = {}) {
            assertActive();
            const nextHub = next.hubSessionId === undefined ? hubSessionId : normalizeId(next.hubSessionId);
            const nextSdk = next.sdkSessionId === undefined ? sdkSessionId : normalizeId(next.sdkSessionId);
            if (nextHub !== hubSessionId || nextSdk !== sdkSessionId) {
                hubSessionId = nextHub;
                sdkSessionId = nextSdk;
                revision += 1;
            }
            return api.snapshot();
        },
        clearSdkSessionId() {
            return setSdk(null);
        },
        clear() {
            assertActive();
            if (hubSessionId !== null || sdkSessionId !== null) {
                hubSessionId = null;
                sdkSessionId = null;
                revision += 1;
            }
            return api.snapshot();
        },
        /** @returns {Readonly<AgentSessionBindingSnapshot>} */
        snapshot() {
            return Object.freeze({ hubSessionId, sdkSessionId, revision, disposed });
        },
        dispose() {
            if (disposed) return;
            hubSessionId = null;
            sdkSessionId = null;
            revision += 1;
            disposed = true;
        },
        [Symbol.dispose]() {
            api.dispose();
        },
    });
    return api;
}

/** @param {string|null|undefined} value */
function normalizeId(value) {
    if (value == null) return null;
    const normalized = String(value).trim();
    return normalized || null;
}
