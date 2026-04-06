// @ts-check
/**
 * src/copilot/agent/session-rotation.js
 *
 * F43.2 (GAP-SD-03): Política de rotação de sessão.
 *
 * Determina quando criar uma nova sessão em vez de resumir a existente, baseado em utilização de contexto, idade da
 * sessão, e contagem de compactions.
 *
 * @module copilot/agent/session-rotation
 */

import { log } from '#copilot/observability/logger';

/**
 * @typedef {Object} RotationDecision
 * @property {boolean} shouldRotate - true se deve criar nova sessão
 * @property {string} reason - Motivo da decisão
 */

/**
 * @typedef {Object} RotationContext
 * @property {number} [contextUtilization] - Fator 0..1 de uso de contexto (obtido de session.usage_info)
 * @property {number} [sessionAgeMs] - Idade da sessão em ms
 * @property {number} [compactionCount] - Número de compactions realizadas
 * @property {number} [totalTurns] - Total de turnos na sessão
 * @property {boolean} [hasCheckpoint] - Se existe checkpoint do SDK
 */

/**
 * @typedef {Object} RotationPolicy
 * @property {number} maxUtilization - Utilização máxima de contexto antes de rotar (default: 0.90)
 * @property {number} maxAgeMs - Idade máxima da sessão em ms (default: 4h)
 * @property {number} maxCompactions - Número máximo de compactions (default: 5)
 * @property {number} maxTurns - Turnos máximos antes de considerar rotação (default: 200)
 */

/** @type {RotationPolicy} */
const DEFAULT_POLICY = {
    maxUtilization: Number(process.env['AGENT_ROTATION_MAX_UTIL'] || 0.9),
    maxAgeMs: Number(process.env['AGENT_ROTATION_MAX_AGE_MS'] || 4 * 60 * 60_000),
    maxCompactions: Number(process.env['AGENT_ROTATION_MAX_COMPACTIONS'] || 5),
    maxTurns: Number(process.env['AGENT_ROTATION_MAX_TURNS'] || 200),
};

/**
 * Avalia se a sessão deve ser rotacionada.
 *
 * @param {RotationContext} ctx - Contexto de avaliação
 * @param {Partial<RotationPolicy>} [policyOverride] - Sobrescrita parcial da política
 * @returns {RotationDecision}
 */
export function shouldRotateSession(ctx, policyOverride) {
    const policy = { ...DEFAULT_POLICY, ...policyOverride };

    if (ctx.contextUtilization !== undefined && ctx.contextUtilization >= policy.maxUtilization) {
        const reason = `Utilização de contexto alta: ${Math.round(ctx.contextUtilization * 100)}% ≥ ${Math.round(policy.maxUtilization * 100)}%`;
        log('INFO', `[SessionRotation] ${reason}`);
        return { shouldRotate: true, reason };
    }

    if (ctx.sessionAgeMs !== undefined && ctx.sessionAgeMs >= policy.maxAgeMs) {
        const reason = `Sessão expirada por idade: ${Math.round(ctx.sessionAgeMs / 3600_000)}h ≥ ${Math.round(policy.maxAgeMs / 3600_000)}h`;
        log('INFO', `[SessionRotation] ${reason}`);
        return { shouldRotate: true, reason };
    }

    if (ctx.compactionCount !== undefined && ctx.compactionCount >= policy.maxCompactions) {
        const reason = `Compactions excessivas: ${ctx.compactionCount} ≥ ${policy.maxCompactions}`;
        log('INFO', `[SessionRotation] ${reason}`);
        return { shouldRotate: true, reason };
    }

    if (ctx.totalTurns !== undefined && ctx.totalTurns >= policy.maxTurns) {
        const reason = `Turnos excessivos: ${ctx.totalTurns} ≥ ${policy.maxTurns}`;
        log('INFO', `[SessionRotation] ${reason}`);
        return { shouldRotate: true, reason };
    }

    return { shouldRotate: false, reason: 'Dentro dos limites da política' };
}
