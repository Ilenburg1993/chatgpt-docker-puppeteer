// @ts-check
/**
 * @module copilot/boot/lifecycle-runner
 * @file Runner executável do plano de boot Copilot, com relatório, timeout e rollback best-effort.
 */

import { toError } from '../core/error-handlers.js';

/**
 * @typedef {'ok' | 'skipped' | 'failed' | 'timeout'} BootPhaseStatus
 *
 * @typedef {{
 *     id: string;
 *     owner: string;
 *     responsibility: string;
 *     timeoutMs?: number;
 * }} BootPlanPhaseLike
 *
 *
 * @typedef {{
 *     id: string;
 *     owner: string;
 *     status: BootPhaseStatus;
 *     timeoutMs: number;
 *     startedAt: number;
 *     completedAt: number;
 *     durationMs: number;
 *     error: string | null;
 * }} BootPhaseReport
 *
 *
 * @typedef {{
 *     id: string;
 *     status: 'ok' | 'failed';
 *     startedAt: number;
 *     completedAt: number;
 *     durationMs: number;
 *     error: string | null;
 * }} BootRollbackReport
 *
 *
 * @typedef {{
 *     mode: string;
 *     workspaceRoot: string;
 *     serverUrl: string;
 *     status: 'ok' | 'failed';
 *     startedAt: number;
 *     completedAt: number;
 *     durationMs: number;
 *     failedPhase: string | null;
 *     phaseCount: number;
 *     okCount: number;
 *     skippedCount: number;
 *     failedCount: number;
 *     timeoutCount: number;
 *     phases: BootPhaseReport[];
 *     rollbacks: BootRollbackReport[];
 * }} BootLifecycleReport
 *
 *
 * @typedef {{
 *     run: () => void | Promise<void>;
 *     rollback?: () => void | Promise<void>;
 * }} BootPhaseHandler
 *
 * @typedef {(event: { type: string; timestamp: number; [key: string]: unknown }) => void} BootLifecycleEventEmitter
 *
 * @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string) => void} BootLifecycleLogFn
 */

const DEFAULT_BOOT_PHASE_TIMEOUT_MS = 30_000;

/** @type {BootLifecycleReport | null} */
let lastBootLifecycleReport = null;

export class BootPhaseTimeoutError extends Error {
    /**
     * @param {string} phaseId
     * @param {number} timeoutMs
     */
    constructor(phaseId, timeoutMs) {
        super(`Boot phase "${phaseId}" timeout after ${timeoutMs}ms`);
        this.name = 'BootPhaseTimeoutError';
    }
}

/**
 * Executa um plano de boot descritivo usando handlers por fase.
 *
 * Fases sem handler são registradas como `skipped`; isso permite que o plano descreva fases delegadas a hosts mais
 * específicos sem perder rastreabilidade global.
 *
 * @param {{
 *     mode: string;
 *     workspaceRoot: string;
 *     serverUrl: string;
 *     phases: BootPlanPhaseLike[];
 * }} plan
 * @param {{
 *     phaseHandlers?: Record<string, BootPhaseHandler | (() => void | Promise<void>)>;
 *     emit?: BootLifecycleEventEmitter | null;
 *     log?: BootLifecycleLogFn | null;
 * }} [options]
 * @returns {Promise<BootLifecycleReport>}
 */
export async function runCopilotBootPlan(plan, options = {}) {
    const startedAt = Date.now();
    /** @type {BootPhaseReport[]} */
    const phases = [];
    /** @type {BootRollbackReport[]} */
    const rollbacks = [];
    /** @type {{ id: string; rollback: () => void | Promise<void> }[]} */
    const rollbackStack = [];
    const emit = typeof options.emit === 'function' ? options.emit : null;
    const log = typeof options.log === 'function' ? options.log : null;
    const phaseHandlers = options.phaseHandlers ?? {};

    emitBootEvent(emit, 'runtime.boot.started', {
        mode: plan.mode,
        workspaceRoot: plan.workspaceRoot,
        serverUrl: plan.serverUrl,
        phaseCount: plan.phases.length,
    });

    try {
        for (const phase of plan.phases) {
            const handler = normalizePhaseHandler(phaseHandlers[phase.id]);
            const timeoutMs = normalizeTimeoutMs(phase.timeoutMs);
            const phaseStartedAt = Date.now();

            if (!handler) {
                const completedAt = Date.now();
                phases.push({
                    id: phase.id,
                    owner: phase.owner,
                    status: 'skipped',
                    timeoutMs,
                    startedAt: phaseStartedAt,
                    completedAt,
                    durationMs: completedAt - phaseStartedAt,
                    error: null,
                });
                continue;
            }

            emitBootEvent(emit, 'runtime.boot.phase_started', {
                phase: phase.id,
                owner: phase.owner,
                timeoutMs,
            });

            try {
                await runPhaseWithTimeout(phase.id, timeoutMs, handler.run);
                const completedAt = Date.now();
                phases.push({
                    id: phase.id,
                    owner: phase.owner,
                    status: 'ok',
                    timeoutMs,
                    startedAt: phaseStartedAt,
                    completedAt,
                    durationMs: completedAt - phaseStartedAt,
                    error: null,
                });
                if (handler.rollback) rollbackStack.push({ id: phase.id, rollback: handler.rollback });
                emitBootEvent(emit, 'runtime.boot.phase_completed', {
                    phase: phase.id,
                    owner: phase.owner,
                    durationMs: completedAt - phaseStartedAt,
                });
            } catch (error) {
                const bootError = toError(error);
                const completedAt = Date.now();
                const status = error instanceof BootPhaseTimeoutError ? 'timeout' : 'failed';
                phases.push({
                    id: phase.id,
                    owner: phase.owner,
                    status,
                    timeoutMs,
                    startedAt: phaseStartedAt,
                    completedAt,
                    durationMs: completedAt - phaseStartedAt,
                    error: bootError.message,
                });
                emitBootEvent(emit, 'runtime.boot.phase_failed', {
                    phase: phase.id,
                    owner: phase.owner,
                    status,
                    durationMs: completedAt - phaseStartedAt,
                    error: bootError.message,
                });
                await runBootRollbacks(rollbackStack, rollbacks, log);
                const report = buildBootLifecycleReport(plan, phases, rollbacks, startedAt, phase.id, 'failed');
                lastBootLifecycleReport = report;
                emitBootEvent(emit, 'runtime.boot.failed', summarizeBootReport(report));
                throw error;
            }
        }

        const report = buildBootLifecycleReport(plan, phases, rollbacks, startedAt, null, 'ok');
        lastBootLifecycleReport = report;
        emitBootEvent(emit, 'runtime.boot.completed', summarizeBootReport(report));
        return report;
    } catch (error) {
        if (!lastBootLifecycleReport) {
            const failedPhase = phases.find((phase) => phase.status === 'failed' || phase.status === 'timeout');
            lastBootLifecycleReport = buildBootLifecycleReport(
                plan,
                phases,
                rollbacks,
                startedAt,
                failedPhase?.id ?? null,
                'failed',
            );
        }
        throw error;
    }
}

/**
 * @returns {BootLifecycleReport | null}
 */
export function getLastBootLifecycleReport() {
    if (!lastBootLifecycleReport) return null;
    return {
        ...lastBootLifecycleReport,
        phases: lastBootLifecycleReport.phases.map((phase) => ({ ...phase })),
        rollbacks: lastBootLifecycleReport.rollbacks.map((rollback) => ({ ...rollback })),
    };
}

/**
 * Uso exclusivo em testes.
 *
 * @returns {void}
 */
export function resetBootLifecycleReportForTests() {
    lastBootLifecycleReport = null;
}

/**
 * @param {BootPhaseHandler | (() => void | Promise<void>) | undefined} handler
 * @returns {BootPhaseHandler | null}
 */
function normalizePhaseHandler(handler) {
    if (!handler) return null;
    if (typeof handler === 'function') return { run: handler };
    return handler;
}

/**
 * @param {number | undefined} timeoutMs
 * @returns {number}
 */
function normalizeTimeoutMs(timeoutMs) {
    return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_BOOT_PHASE_TIMEOUT_MS;
}

/**
 * @param {string} phaseId
 * @param {number} timeoutMs
 * @param {() => void | Promise<void>} run
 * @returns {Promise<void>}
 */
async function runPhaseWithTimeout(phaseId, timeoutMs, run) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeout = null;
    try {
        await Promise.race([
            Promise.resolve().then(run),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new BootPhaseTimeoutError(phaseId, timeoutMs)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

/**
 * @param {{ id: string; rollback: () => void | Promise<void> }[]} rollbackStack
 * @param {BootRollbackReport[]} rollbacks
 * @param {BootLifecycleLogFn | null} log
 * @returns {Promise<void>}
 */
async function runBootRollbacks(rollbackStack, rollbacks, log) {
    for (const item of rollbackStack.reverse()) {
        const startedAt = Date.now();
        try {
            await Promise.resolve(item.rollback());
            const completedAt = Date.now();
            rollbacks.push({
                id: item.id,
                status: 'ok',
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                error: null,
            });
        } catch (error) {
            const completedAt = Date.now();
            const message = toError(error).message;
            rollbacks.push({
                id: item.id,
                status: 'failed',
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                error: message,
            });
            log?.('WARN', `[boot] rollback da fase ${item.id} falhou: ${message}`);
        }
    }
}

/**
 * @param {{ mode: string; workspaceRoot: string; serverUrl: string; phases: BootPlanPhaseLike[] }} plan
 * @param {BootPhaseReport[]} phases
 * @param {BootRollbackReport[]} rollbacks
 * @param {number} startedAt
 * @param {string | null} failedPhase
 * @param {'ok' | 'failed'} status
 * @returns {BootLifecycleReport}
 */
function buildBootLifecycleReport(plan, phases, rollbacks, startedAt, failedPhase, status) {
    const completedAt = Date.now();
    const okCount = phases.filter((phase) => phase.status === 'ok').length;
    const skippedCount = phases.filter((phase) => phase.status === 'skipped').length;
    const timeoutCount = phases.filter((phase) => phase.status === 'timeout').length;
    const failedCount = phases.filter((phase) => phase.status === 'failed').length;
    return {
        mode: plan.mode,
        workspaceRoot: plan.workspaceRoot,
        serverUrl: plan.serverUrl,
        status,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        failedPhase,
        phaseCount: plan.phases.length,
        okCount,
        skippedCount,
        failedCount,
        timeoutCount,
        phases,
        rollbacks,
    };
}

/**
 * @param {BootLifecycleEventEmitter | null} emit
 * @param {string} type
 * @param {Record<string, unknown>} payload
 * @returns {void}
 */
function emitBootEvent(emit, type, payload) {
    if (!emit) return;
    try {
        emit({ type, timestamp: Date.now(), ...payload });
    } catch {
        // Evento de observabilidade nunca bloqueia o boot.
    }
}

/**
 * @param {BootLifecycleReport} report
 * @returns {Record<string, unknown>}
 */
function summarizeBootReport(report) {
    return {
        mode: report.mode,
        workspaceRoot: report.workspaceRoot,
        serverUrl: report.serverUrl,
        status: report.status,
        durationMs: report.durationMs,
        failedPhase: report.failedPhase,
        phaseCount: report.phaseCount,
        okCount: report.okCount,
        skippedCount: report.skippedCount,
        failedCount: report.failedCount,
        timeoutCount: report.timeoutCount,
    };
}
