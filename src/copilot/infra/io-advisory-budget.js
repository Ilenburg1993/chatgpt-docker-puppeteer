// @ts-check
/**
 * Orçamento advisory de I/O local.
 *
 * Mede pressão recente de operações mutáveis e builds de índice sem bloquear, atrasar ou rejeitar trabalho.
 *
 * @module copilot/infra/io-advisory-budget
 */

import { publishIoLifecycleEvent } from './io-observability.js';
import { readEnvPositiveInt } from './shared/env.js';

const WINDOW_MS = readEnvPositiveInt('IO_ADVISORY_BUDGET_WINDOW_MS', 60_000);
const MAX_OPERATIONS = readEnvPositiveInt('IO_ADVISORY_BUDGET_MAX_OPERATIONS', 120);
const MAX_BYTES = readEnvPositiveInt('IO_ADVISORY_BUDGET_MAX_BYTES', 64 * 1024 * 1024);
const MAX_ACTIVE = readEnvPositiveInt('IO_ADVISORY_BUDGET_MAX_ACTIVE', 12);
const EVENT_COOLDOWN_MS = readEnvPositiveInt('IO_ADVISORY_BUDGET_EVENT_COOLDOWN_MS', 5_000);
const MAX_SAMPLES = 10_000;

/** @type {Array<{ id: number; at: number; operation: string; estimatedBytes: number }>} */
let _samples = [];
let _active = 0;
let _nextId = 1;
let _lastPressureEventAt = 0;

/**
 * @param {number} now
 */
function pruneSamples(now) {
    const cutoff = now - WINDOW_MS;
    let firstRetained = 0;
    while ((_samples[firstRetained]?.at ?? Number.POSITIVE_INFINITY) < cutoff) firstRetained += 1;
    if (firstRetained > 0) _samples = _samples.slice(firstRetained);
    if (_samples.length > MAX_SAMPLES) _samples = _samples.slice(-MAX_SAMPLES);
}

/**
 * @param {number} now
 */
function buildStats(now) {
    pruneSamples(now);
    const estimatedBytes = _samples.reduce((total, sample) => total + sample.estimatedBytes, 0);
    const reasons = [];
    if (_samples.length > MAX_OPERATIONS) reasons.push('operations');
    if (estimatedBytes > MAX_BYTES) reasons.push('bytes');
    if (_active > MAX_ACTIVE) reasons.push('active');
    return {
        windowMs: WINDOW_MS,
        operations: _samples.length,
        estimatedBytes,
        active: _active,
        pressure: reasons.length > 0,
        reasons,
        limits: {
            maxOperations: MAX_OPERATIONS,
            maxBytes: MAX_BYTES,
            maxActive: MAX_ACTIVE,
        },
    };
}

/**
 * Registra uma operação no orçamento advisory.
 *
 * @param {{ operation: string; estimatedBytes?: number; nowMs?: number }} input
 * @returns {{ id: number; pressured: boolean; finish: () => void }}
 */
export function beginIoAdvisoryBudget(input) {
    const now = input.nowMs ?? Date.now();
    const id = _nextId++;
    const estimatedBytes = Math.max(0, Math.trunc(Number(input.estimatedBytes) || 0));
    _samples.push({
        id,
        at: now,
        operation: String(input.operation || 'unknown').slice(0, 80),
        estimatedBytes,
    });
    _active += 1;

    const stats = buildStats(now);
    if (stats.pressure && now - _lastPressureEventAt >= EVENT_COOLDOWN_MS) {
        _lastPressureEventAt = now;
        publishIoLifecycleEvent('budget', 'pressure', {
            operation: String(input.operation || 'unknown').slice(0, 80),
            ...stats,
        });
    }

    let finished = false;
    return {
        id,
        pressured: stats.pressure,
        finish() {
            if (finished) return;
            finished = true;
            _active = Math.max(0, _active - 1);
        },
    };
}

/**
 * @returns {ReturnType<typeof buildStats>}
 */
export function getIoAdvisoryBudgetStats() {
    return buildStats(Date.now());
}

export function resetIoAdvisoryBudgetForTest() {
    _samples = [];
    _active = 0;
    _nextId = 1;
    _lastPressureEventAt = 0;
}
