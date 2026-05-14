// @ts-check
/**
 * Classificação padronizada de risco para operações Copilot IO/tools.
 *
 * @module copilot/infra/policy/risk
 */

export const IO_RISK = /** @type {const} */ ({
    low: 'low',
    medium: 'medium',
    high: 'high',
});

/**
 * @param {boolean} overwrite
 * @returns {import('../../core/io-contracts.js').IoRiskClass}
 */
export function riskForOverwrite(overwrite) {
    return overwrite ? IO_RISK.high : IO_RISK.medium;
}

/**
 * @param {boolean} dryRun
 * @param {import('../../core/io-contracts.js').IoRiskClass} [appliedRisk]
 * @returns {import('../../core/io-contracts.js').IoRiskClass}
 */
export function riskForDryRun(dryRun, appliedRisk = IO_RISK.high) {
    return dryRun ? IO_RISK.low : appliedRisk;
}
