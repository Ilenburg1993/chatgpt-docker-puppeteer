// @ts-check
/**
 * @module copilot/presentation/dialog-timeout-policy
 * @file Política compartilhada de timeout adaptativo para callers do dialog loop.
 *
 *   A regra é pura e vive em `presentation` porque governa como bordas operacionais (`server` e `terminal`) projetam
 *   pressão de fila, contexto e latência recente para uma chamada ao dialog loop. O agent continua dono da execução.
 */

/**
 * @typedef {{
 *     explicitTimeoutMs?: number | undefined;
 *     defaultTimeoutMs: number;
 *     queueDepth?: number | undefined;
 *     contextUtilization?: number | undefined;
 *     recentP50Ms?: number | undefined;
 *     recentP95Ms?: number | undefined;
 *     recentP99Ms?: number | undefined;
 *     recentTimeoutRate?: number | undefined;
 *     payloadChars?: number | undefined;
 *     phase?: 'inject' | 'pipeline' | 'dialog' | 'boot' | undefined;
 * }} AdaptiveDialogTimeoutInput
 */

/**
 * @typedef {{
 *     timeoutMs: number;
 *     strategy: 'explicit' | 'adaptive';
 *     reasons: string[];
 * }} AdaptiveDialogTimeoutDecision
 */

const MIN_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const MIN_TRANSPORT_TIMEOUT_MS = 15_000;
const MAX_TRANSPORT_TIMEOUT_MS = 30 * 60_000;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundUpToNearestSecond(value) {
    return Math.ceil(value / 1000) * 1000;
}

/**
 * Resolve um timeout adaptativo para chamadas ao dialog loop.
 *
 * @param {AdaptiveDialogTimeoutInput} input
 * @returns {AdaptiveDialogTimeoutDecision}
 */
export function computeAdaptiveDialogTimeout(input) {
    const explicitTimeoutMs =
        typeof input.explicitTimeoutMs === 'number' &&
        Number.isFinite(input.explicitTimeoutMs) &&
        input.explicitTimeoutMs > 0
            ? Math.min(input.explicitTimeoutMs, MAX_TIMEOUT_MS)
            : null;

    if (explicitTimeoutMs !== null) {
        return {
            timeoutMs: explicitTimeoutMs,
            strategy: 'explicit',
            reasons: ['caller'],
        };
    }

    const phase = input.phase ?? 'dialog';
    const reasons = ['baseline', `phase:${phase}`];
    const baseTimeoutMs = roundUpToNearestSecond(clamp(input.defaultTimeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
    const recentP50Ms = typeof input.recentP50Ms === 'number' ? input.recentP50Ms : 0;
    const recentP95Ms = typeof input.recentP95Ms === 'number' ? input.recentP95Ms : 0;
    const recentP99Ms = typeof input.recentP99Ms === 'number' ? input.recentP99Ms : 0;

    let computedMs = baseTimeoutMs;
    const latencyDrivenMs = Math.max(
        baseTimeoutMs,
        recentP50Ms > 0 ? Math.round(recentP50Ms * 2.2) : 0,
        recentP95Ms > 0 ? Math.round(recentP95Ms * 1.35) : 0,
        recentP99Ms > 0 ? Math.round(recentP99Ms * 1.15) : 0,
    );
    if (latencyDrivenMs > computedMs) {
        computedMs = latencyDrivenMs;
        reasons.push('recent_latency');
    }

    const queueDepth = clamp(Math.round(input.queueDepth ?? 0), 0, 8);
    if (queueDepth > 0) {
        computedMs *= 1 + queueDepth * 0.18;
        reasons.push('queue_depth');
    }

    const contextUtilization = clamp(Number(input.contextUtilization ?? 0), 0, 1);
    if (contextUtilization >= 0.95) {
        computedMs *= 1.45;
        reasons.push('context_critical');
    } else if (contextUtilization >= 0.85) {
        computedMs *= 1.25;
        reasons.push('context_high');
    } else if (contextUtilization >= 0.7) {
        computedMs *= 1.1;
        reasons.push('context_moderate');
    }

    const recentTimeoutRate = clamp(Number(input.recentTimeoutRate ?? 0), 0, 1);
    if (recentTimeoutRate >= 0.2) {
        computedMs *= 1.35;
        reasons.push('timeouts_high');
    } else if (recentTimeoutRate >= 0.08) {
        computedMs *= 1.15;
        reasons.push('timeouts_present');
    }

    const payloadChars = Math.max(0, Math.round(Number(input.payloadChars ?? 0)));
    if (payloadChars >= 12_000) {
        computedMs *= 1.35;
        reasons.push('payload_xlarge');
    } else if (payloadChars >= 6_000) {
        computedMs *= 1.2;
        reasons.push('payload_large');
    } else if (payloadChars >= 2_000) {
        computedMs *= 1.1;
        reasons.push('payload_medium');
    }

    return {
        timeoutMs: roundUpToNearestSecond(clamp(computedMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)),
        strategy: 'adaptive',
        reasons,
    };
}

/**
 * @typedef {{
 *     timeoutMs: number | null;
 *     strategy: 'explicit' | 'adaptive' | 'disabled';
 *     reasons: string[];
 * }} OptionalDialogTimeoutDecision
 */

/**
 * Resolve um timeout adaptativo opcional para chamadas ao dialog loop.
 *
 * `explicitTimeoutMs=0` é tratado como desabilitação explícita quando `allowDisabled=true`.
 *
 * @param {AdaptiveDialogTimeoutInput & { allowDisabled?: boolean | undefined }} input
 * @returns {OptionalDialogTimeoutDecision}
 */
export function resolveOptionalDialogTimeout(input) {
    if (input.allowDisabled && input.explicitTimeoutMs === 0) {
        return {
            timeoutMs: null,
            strategy: 'disabled',
            reasons: ['caller_disabled'],
        };
    }

    const decision = computeAdaptiveDialogTimeout(input);
    return decision;
}

/**
 * @typedef {{
 *     turnTimeoutMs: number;
 *     explicitTransportTimeoutMs?: number | undefined;
 *     recentP95Ms?: number | undefined;
 *     queueDepth?: number | undefined;
 *     phase?: 'inject' | 'pipeline' | 'dialog' | 'boot' | undefined;
 * }} AdaptiveTransportTimeoutInput
 */

/**
 * @typedef {{
 *     timeoutMs: number;
 *     strategy: 'explicit' | 'adaptive';
 *     reasons: string[];
 * }} AdaptiveTransportTimeoutDecision
 */

/**
 * Resolve timeout de transporte (HTTP/request) sem conflitar com o timeout semântico do turno.
 *
 * Regra: o transporte sempre precisa de folga acima do turno para serialização, escrita de resposta, flush de socket e
 * overhead de borda.
 *
 * @param {AdaptiveTransportTimeoutInput} input
 * @returns {AdaptiveTransportTimeoutDecision}
 */
export function computeAdaptiveTransportTimeout(input) {
    const explicit =
        typeof input.explicitTransportTimeoutMs === 'number' &&
        Number.isFinite(input.explicitTransportTimeoutMs) &&
        input.explicitTransportTimeoutMs > 0
            ? clamp(input.explicitTransportTimeoutMs, MIN_TRANSPORT_TIMEOUT_MS, MAX_TRANSPORT_TIMEOUT_MS)
            : null;

    if (explicit !== null) {
        return {
            timeoutMs: roundUpToNearestSecond(explicit),
            strategy: 'explicit',
            reasons: ['caller'],
        };
    }

    const phase = input.phase ?? 'dialog';
    const reasons = ['baseline', `phase:${phase}`];
    const queueDepth = clamp(Math.round(input.queueDepth ?? 0), 0, 8);
    const recentP95Ms = Math.max(0, Number(input.recentP95Ms ?? 0));

    const baseTurnMs = clamp(input.turnTimeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const transportFloorMs = Math.max(baseTurnMs + 20_000, Math.round(baseTurnMs * 1.2));
    let computedMs = transportFloorMs;

    const latencyHeadroomMs = recentP95Ms > 0 ? Math.round(recentP95Ms * 1.35 + 15_000) : 0;
    if (latencyHeadroomMs > computedMs) {
        computedMs = latencyHeadroomMs;
        reasons.push('recent_latency');
    }

    if (queueDepth > 0) {
        computedMs *= 1 + queueDepth * 0.1;
        reasons.push('queue_depth');
    }

    if (phase === 'pipeline') {
        computedMs *= 1.2;
        reasons.push('pipeline_overhead');
    }

    return {
        timeoutMs: roundUpToNearestSecond(clamp(computedMs, MIN_TRANSPORT_TIMEOUT_MS, MAX_TRANSPORT_TIMEOUT_MS)),
        strategy: 'adaptive',
        reasons,
    };
}
