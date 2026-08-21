// @ts-check
/**
 * Estado local de SSE para `/sdk/sessions/:id/stream`.
 */

import {
    buildSdkSessionStreamKey,
    deleteSdkSessionStreamState,
    getSdkSessionStreamState,
    setSdkSessionStreamState,
} from '../../runtime-state/sdk-session-stream.js';

/**
 * @typedef {ReturnType<typeof import('./deps.js').resolveSdkRouteSharedDeps>} SdkRouteDeps
 *
 * @typedef {{ type?: string; data?: { message?: string; stack?: string }; [key: string]: unknown }} RouteSessionEvent
 *
 * @typedef {{
 *     key: string;
 *     runtimeId: string;
 *     sessionId: string;
 *     sessionRef: NonNullable<ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>>['session'];
 *     pool: InstanceType<SdkRouteDeps['sdkRealtime']['SseClientPool']>;
 *     unsubscribe: () => void;
 * }} SessionStreamState
 */

// C14-03: limite de SSE streams simultâneos por /sessions/:id/stream.
/** @type {ReturnType<typeof createSessionsTracker> | null} */
let sessionsTracker = null;

/** @param {SdkRouteDeps} routeDeps */
function createSessionsTracker(routeDeps) {
    return new routeDeps.sdkRealtime.SseConnectionTracker('sessions/stream');
}

/** @param {SdkRouteDeps} routeDeps */
export function getSessionsTracker(routeDeps) {
    sessionsTracker ??= createSessionsTracker(routeDeps);
    return sessionsTracker;
}

/**
 * @param {SdkRouteDeps} routeDeps
 * @param {string} id
 * @param {ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>} entry
 * @returns {SessionStreamState}
 */
export function ensureSessionStreamState(routeDeps, id, entry) {
    if (!entry) {
        throw new Error(`Sessão "${id}" não está ativa para stream SSE.`);
    }
    const runtimeId = routeDeps.runtimeId || 'default';
    const key = buildSdkSessionStreamKey(runtimeId, id);
    const existing = /** @type {SessionStreamState | undefined} */ (getSdkSessionStreamState(key));
    if (existing && existing.sessionRef === entry.session) return existing;

    if (existing) {
        existing.pool.closeAll();
        existing.unsubscribe();
        deleteSdkSessionStreamState(key);
    }

    const pool = new routeDeps.sdkRealtime.SseClientPool(new routeDeps.sdkRealtime.SseReplayBuffer(), {
        name: `sdk.session.stream.${runtimeId}.${id}`,
        metrics: routeDeps.metrics,
    });

    const unsubscribe = routeDeps.sdkSessionEvents.onAllSessionEvents(
        entry.session,
        (/** @type {RouteSessionEvent} */ event) => {
            const type = /** @type {string} */ (event?.type ?? 'message');
            const payload = routeDeps.sdkRealtime.standardizeSsePayload({ ...event, runtimeId });
            pool.broadcast('message', payload, { replayEvent: 'message', filterEvent: type });
        },
    );

    const state = { key, runtimeId, sessionId: id, sessionRef: entry.session, pool, unsubscribe };
    setSdkSessionStreamState(key, state);
    return state;
}

/**
 * @param {SdkRouteDeps} routeDeps
 * @param {SessionStreamState} state
 * @returns {void}
 */
export function maybeDisposeSessionStreamState(routeDeps, state) {
    if (state.pool.size > 0) return;
    state.unsubscribe();
    deleteSdkSessionStreamState(state.key);
    routeDeps.sdkObservability.log(
        'INFO',
        `[sdk-api] SSE stream encerrado: runtime ${state.runtimeId} sessão ${state.sessionId}`,
    );
}
