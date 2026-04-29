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
 *     phaseId: string | null;
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
 *     id: string;
 *     attempts: number;
 *     okCount: number;
 *     skippedCount: number;
 *     failedCount: number;
 *     timeoutCount: number;
 *     totalDurationMs: number;
 *     avgDurationMs: number;
 *     lastStatus: BootPhaseStatus;
 *     lastDurationMs: number;
 *     lastCompletedAt: number;
 *     lastError: string | null;
 * }} BootPhaseMetric
 *
 *
 * @typedef {{
 *     phaseId: string;
 *     registerRollback: (id: string, rollback: () => void | Promise<void>) => void;
 * }} BootPhaseRunContext
 *
 *
 * @typedef {{
 *     run: (context: BootPhaseRunContext) => void | Promise<void>;
 *     rollback?: () => void | Promise<void>;
 * }} BootPhaseHandler
 *
 *
 * @typedef {(event: { type: string; timestamp: number; [key: string]: unknown }) => void} BootLifecycleEventEmitter
 *
 * @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string) => void} BootLifecycleLogFn
 */

const DEFAULT_BOOT_PHASE_TIMEOUT_MS = 30_000;

/** @type {BootLifecycleReport | null} */
let lastBootLifecycleReport = null;
/** @type {Map<string, Omit<BootPhaseMetric, 'avgDurationMs'>>} */
const bootPhaseMetrics = new Map();

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
 *     phaseHandlers?: Record<string, BootPhaseHandler | ((context: BootPhaseRunContext) => void | Promise<void>)>;
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
    /** @type {{ id: string; phaseId: string | null; rollback: () => void | Promise<void> }[]} */
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
                const report = {
                    id: phase.id,
                    owner: phase.owner,
                    status: /** @type {const} */ ('skipped'),
                    timeoutMs,
                    startedAt: phaseStartedAt,
                    completedAt,
                    durationMs: completedAt - phaseStartedAt,
                    error: null,
                };
                phases.push(report);
                recordBootPhaseMetric(report);
                continue;
            }

            const phaseContext = createBootPhaseRunContext(phase.id, rollbackStack);
            emitBootEvent(emit, 'runtime.boot.phase_started', {
                phase: phase.id,
                owner: phase.owner,
                timeoutMs,
            });

            try {
                await runPhaseWithTimeout(phase.id, timeoutMs, handler.run, phaseContext);
                const completedAt = Date.now();
                const report = {
                    id: phase.id,
                    owner: phase.owner,
                    status: /** @type {const} */ ('ok'),
                    timeoutMs,
                    startedAt: phaseStartedAt,
                    completedAt,
                    durationMs: completedAt - phaseStartedAt,
                    error: null,
                };
                phases.push(report);
                recordBootPhaseMetric(report);
                if (handler.rollback) {
                    rollbackStack.push({ id: phase.id, phaseId: phase.id, rollback: handler.rollback });
                }
                emitBootEvent(emit, 'runtime.boot.phase_completed', {
                    phase: phase.id,
                    owner: phase.owner,
                    durationMs: completedAt - phaseStartedAt,
                });
            } catch (error) {
                const bootError = toError(error);
                const completedAt = Date.now();
                const status = error instanceof BootPhaseTimeoutError ? 'timeout' : 'failed';
                const phaseReport = {
                    id: phase.id,
                    owner: phase.owner,
                    status: /** @type {BootPhaseStatus} */ (status),
                    timeoutMs,
                    startedAt: phaseStartedAt,
                    completedAt,
                    durationMs: completedAt - phaseStartedAt,
                    error: bootError.message,
                };
                phases.push(phaseReport);
                recordBootPhaseMetric(phaseReport);
                emitBootEvent(emit, 'runtime.boot.phase_failed', {
                    phase: phase.id,
                    owner: phase.owner,
                    status,
                    durationMs: completedAt - phaseStartedAt,
                    error: bootError.message,
                });
                await runBootRollbacks(rollbackStack, rollbacks, log);
                const lifecycleReport = buildBootLifecycleReport(
                    plan,
                    phases,
                    rollbacks,
                    startedAt,
                    phase.id,
                    'failed',
                );
                lastBootLifecycleReport = lifecycleReport;
                emitBootEvent(emit, 'runtime.boot.failed', summarizeBootReport(lifecycleReport));
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
 * Retorna métricas agregadas por fase desde o último reset do processo.
 *
 * @returns {BootPhaseMetric[]}
 */
export function getBootLifecycleMetrics() {
    return Array.from(bootPhaseMetrics.values())
        .map((metric) => ({
            ...metric,
            avgDurationMs: metric.attempts > 0 ? Math.round(metric.totalDurationMs / metric.attempts) : 0,
        }))
        .sort((a, b) => b.totalDurationMs - a.totalDurationMs || a.id.localeCompare(b.id));
}

/**
 * Uso exclusivo em testes.
 *
 * @returns {void}
 */
export function resetBootLifecycleReportForTests() {
    lastBootLifecycleReport = null;
    bootPhaseMetrics.clear();
}

/**
 * @param {BootPhaseHandler | ((context: BootPhaseRunContext) => void | Promise<void>) | undefined} handler
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
 * @param {BootPhaseReport} phase
 * @returns {void}
 */
function recordBootPhaseMetric(phase) {
    const existing = bootPhaseMetrics.get(phase.id) ?? {
        id: phase.id,
        attempts: 0,
        okCount: 0,
        skippedCount: 0,
        failedCount: 0,
        timeoutCount: 0,
        totalDurationMs: 0,
        lastStatus: phase.status,
        lastDurationMs: 0,
        lastCompletedAt: 0,
        lastError: null,
    };
    existing.attempts += 1;
    existing.totalDurationMs += phase.durationMs;
    existing.lastStatus = phase.status;
    existing.lastDurationMs = phase.durationMs;
    existing.lastCompletedAt = phase.completedAt;
    existing.lastError = phase.error;
    if (phase.status === 'ok') existing.okCount += 1;
    else if (phase.status === 'skipped') existing.skippedCount += 1;
    else if (phase.status === 'timeout') existing.timeoutCount += 1;
    else existing.failedCount += 1;
    bootPhaseMetrics.set(phase.id, existing);
}

/**
 * Cria o contexto mutável de uma fase para que handlers transacionais registrem rollbacks parciais assim que alocam
 * recursos. Isso cobre falhas dentro da própria fase, antes que o rollback de fase completa possa ser registrado.
 *
 * @param {string} phaseId
 * @param {{ id: string; phaseId: string | null; rollback: () => void | Promise<void> }[]} rollbackStack
 * @returns {BootPhaseRunContext}
 */
function createBootPhaseRunContext(phaseId, rollbackStack) {
    return {
        phaseId,
        registerRollback(id, rollback) {
            if (typeof id !== 'string' || id.trim() === '') {
                throw new TypeError(`Boot phase "${phaseId}" tried to register a rollback without id`);
            }
            if (typeof rollback !== 'function') {
                throw new TypeError(`Boot phase "${phaseId}" rollback "${id}" is not executable`);
            }
            rollbackStack.push({ id: `${phaseId}:${id.trim()}`, phaseId, rollback });
        },
    };
}

/**
 * @param {string} phaseId
 * @param {number} timeoutMs
 * @param {(context: BootPhaseRunContext) => void | Promise<void>} run
 * @param {BootPhaseRunContext} context
 * @returns {Promise<void>}
 */
async function runPhaseWithTimeout(phaseId, timeoutMs, run, context) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeout = null;
    try {
        await Promise.race([
            Promise.resolve().then(() => run(context)),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new BootPhaseTimeoutError(phaseId, timeoutMs)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

/**
 * @param {{ id: string; phaseId: string | null; rollback: () => void | Promise<void> }[]} rollbackStack
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
                phaseId: item.phaseId,
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
                phaseId: item.phaseId,
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
