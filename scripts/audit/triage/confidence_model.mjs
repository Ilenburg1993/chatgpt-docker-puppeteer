// @ts-check
/**
 * @typedef {object} ScoreConfidenceSignals
 * @property {number} [sourceConvergence]
 * @property {boolean} [hasContract]
 * @property {boolean} [hasRuntimeEvidence]
 */
/**
 * @typedef {any} ScoreConfidenceFinding
 */
/**
 * @param {ScoreConfidenceFinding} finding
 * @param {ScoreConfidenceSignals} [signals]
  * @returns {number}
 */
export function scoreConfidence(finding, signals = {}) {
    let score = 0.45;

    if (finding.severity === 'P0') score += 0.2;
    else if (finding.severity === 'P1') score += 0.14;
    else if (finding.severity === 'P2') score += 0.08;

    if (signals.hasContract || Boolean(finding.contract_id)) score += 0.12;
    if (signals.hasRuntimeEvidence || /test|runtime|smoke/i.test(String(finding.source_tool || ''))) score += 0.08;
    if (Number.isFinite(signals.sourceConvergence)) {
        score += Math.min(0.15, Number(signals.sourceConvergence) * 0.05);
    }
    if (finding.partial === true) score -= 0.08;

    const normalized = Math.max(0.2, Math.min(0.98, score));
    return Number(normalized.toFixed(2));
}
