// @ts-check
/**
 * Neutral supervision primitives for child processes owned by the MCP runtime.
 *
 * This owner is deliberately below terminal, validators, Cloudflare and integrations. It owns only attached child
 * lifecycle observation and process-tree signalling. It does not decide which commands may run, how credentials are
 * projected, or what application status a child exit means.
 *
 * @module copilot/mcp/process/supervision/runtime
 */

export const MCP_PROCESS_SUPERVISION_VERSION = '1.0.0';
export const DEFAULT_PROCESS_TERMINATION_GRACE_MS = 1_500;

/**
 * @typedef {'running' | 'termination-requested' | 'closed'} AttachedChildProcessState
 * @typedef {Readonly<{
 *     pid: number | null;
 *     exitCode: number | null;
 *     signal: NodeJS.Signals | null;
 *     terminationRequested: boolean;
 *     requestedSignal: NodeJS.Signals | null;
 * }>} AttachedChildCloseObservation
 *
 * @typedef {Readonly<{
 *     version: string;
 *     pid: number | null;
 *     state: AttachedChildProcessState;
 *     terminationRequested: boolean;
 *     requestedSignal: NodeJS.Signals | null;
 *     forceKillScheduled: boolean;
 * }>} AttachedChildProcessSnapshot
 */

/**
 * Supervise one already-spawned child. The `closed` promise resolves only from Node's child `close` event, therefore a
 * caller can distinguish "termination requested" from "process and stdio actually observed closed".
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ processGroup?: boolean }} [options]
 */
export function createAttachedChildProcessSupervisor(child, options = {}) {
    if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function') {
        throw new TypeError('Attached child supervision requires a Node ChildProcess.');
    }
    const pid = typeof child.pid === 'number' && child.pid > 0 ? child.pid : null;
    const processGroup = options.processGroup !== false;
    /** @type {AttachedChildProcessState} */
    let state = 'running';
    let terminationRequested = false;
    /** @type {NodeJS.Signals | null} */
    let requestedSignal = null;
    /** @type {NodeJS.Timeout | null} */
    let forceKillTimer = null;
    /** @type {(observation: AttachedChildCloseObservation) => void} */
    let resolveClosed = () => {};
    /** @type {Promise<AttachedChildCloseObservation>} */
    const closed = new Promise((resolve) => {
        resolveClosed = resolve;
    });

    const cancelEscalation = () => {
        if (!forceKillTimer) return false;
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
        return true;
    };

    child.once('close', (exitCode, signal) => {
        cancelEscalation();
        state = 'closed';
        resolveClosed(
            Object.freeze({
                pid,
                exitCode,
                signal,
                terminationRequested,
                requestedSignal,
            }),
        );
    });

    /** @param {NodeJS.Signals} signal */
    const signal = (signal) => signalProcessTree(pid, signal, { child, processGroup });

    /**
     * @param {{
     *     graceMs?: number;
     *     initialSignal?: NodeJS.Signals;
     *     forceSignal?: NodeJS.Signals;
     * }} [termination]
     */
    const requestTermination = (termination = {}) => {
        if (state === 'closed') {
            return {
                requested: false,
                alreadyClosed: true,
                initialSignalDelivered: false,
                forceKillScheduled: false,
            };
        }
        const initialSignal = termination.initialSignal ?? 'SIGTERM';
        const forceSignal = termination.forceSignal ?? 'SIGKILL';
        const graceMs = normalizeGraceMs(termination.graceMs);
        terminationRequested = true;
        requestedSignal = initialSignal;
        state = 'termination-requested';
        const initialSignalDelivered = signal(initialSignal);
        cancelEscalation();
        if (graceMs === 0) {
            signal(forceSignal);
        } else {
            forceKillTimer = setTimeout(() => {
                forceKillTimer = null;
                if (state !== 'closed') signal(forceSignal);
            }, graceMs);
            forceKillTimer.unref();
        }
        return {
            requested: true,
            alreadyClosed: false,
            initialSignalDelivered,
            forceKillScheduled: graceMs > 0,
        };
    };

    /** @returns {AttachedChildProcessSnapshot} */
    const snapshot = () =>
        Object.freeze({
            version: MCP_PROCESS_SUPERVISION_VERSION,
            pid,
            state,
            terminationRequested,
            requestedSignal,
            forceKillScheduled: forceKillTimer !== null,
        });

    return Object.freeze({
        pid,
        closed,
        signal,
        requestTermination,
        cancelEscalation,
        snapshot,
    });
}

/**
 * Signal a process tree and report the concrete authority path that accepted the signal.
 *
 * @param {number | null | undefined} pid
 * @param {NodeJS.Signals} signal
 * @param {{ child?: import('node:child_process').ChildProcess | null; processGroup?: boolean }} [options]
 * @returns {Readonly<{ delivered: boolean; target: 'process-group' | 'pid' | 'child' | 'none' }>}
 */
export function signalProcessTreeDetailed(pid, signal, options = {}) {
    const normalizedPid = typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null;
    if (normalizedPid !== null && process.platform !== 'win32' && options.processGroup !== false) {
        try {
            process.kill(-normalizedPid, signal);
            return Object.freeze({ delivered: true, target: /** @type {const} */ ('process-group') });
        } catch {
            // Fall through to concrete PID and attached-handle signalling.
        }
    }
    if (normalizedPid !== null) {
        try {
            process.kill(normalizedPid, signal);
            return Object.freeze({ delivered: true, target: /** @type {const} */ ('pid') });
        } catch {
            // Fall through to ChildProcess.kill when an attached handle exists.
        }
    }
    try {
        const delivered = options.child?.kill(signal) ?? false;
        return Object.freeze({
            delivered,
            target: delivered ? /** @type {const} */ ('child') : /** @type {const} */ ('none'),
        });
    } catch {
        return Object.freeze({ delivered: false, target: /** @type {const} */ ('none') });
    }
}

/**
 * Signal a process group when possible, falling back to the concrete PID and finally ChildProcess.kill().
 *
 * @param {number | null | undefined} pid
 * @param {NodeJS.Signals} signal
 * @param {{ child?: import('node:child_process').ChildProcess | null; processGroup?: boolean }} [options]
 * @returns {boolean}
 */
export function signalProcessTree(pid, signal, options = {}) {
    return signalProcessTreeDetailed(pid, signal, options).delivered;
}

/** @param {unknown} value */
function normalizeGraceMs(value) {
    if (value === undefined) return DEFAULT_PROCESS_TERMINATION_GRACE_MS;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_PROCESS_TERMINATION_GRACE_MS;
    return Math.max(0, Math.min(30_000, Math.trunc(parsed)));
}
