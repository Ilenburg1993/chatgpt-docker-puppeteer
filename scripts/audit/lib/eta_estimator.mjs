// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} CreateEtaEstimatorOptions
 * @property {string} historyPath
 * @property {string} scopeKey
 * @property {number} ewmaAlpha
 */
/**
 * @param {CreateEtaEstimatorOptions} options
 * @returns {object}
 */
export function createEtaEstimator(options) {
    const historyPath = options.historyPath;
    const scopeKey = String(options.scopeKey || 'default');
    const ewmaAlpha = Math.max(0.05, Math.min(1, Number(options.ewmaAlpha || 0.35)));

    /** @type {Record<string, { avg_ms: number; count: number }>} */
    let history = {};

    if (fs.existsSync(historyPath)) {
        try {
            history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        } catch {
            history = {};
        }
    }

    /** @type {Map<string, number>} */
    const currentDurations = new Map();

    /** @param {string} stepKey */
    function scopedStepKey(stepKey) {
        return `${scopeKey}::${stepKey}`;
    }

    /** @param {string} stepKey */
    function beginStep(stepKey) {
        currentDurations.set(scopedStepKey(stepKey), Date.now());
    }

    /** @param {string} stepKey */
    function endStep(stepKey) {
        const scoped = scopedStepKey(stepKey);
        const start = currentDurations.get(scoped);
        if (!start) {
            return 0;
        }

        currentDurations.delete(scoped);
        const durationMs = Date.now() - start;
        const prev = history[scoped] || { avg_ms: 0, count: 0 };
        const nextCount = prev.count + 1;
        const nextAvg =
            prev.count === 0 ? durationMs : Math.round(prev.avg_ms * (1 - ewmaAlpha) + durationMs * ewmaAlpha);
        history[scoped] = { avg_ms: nextAvg, count: nextCount };
        return durationMs;
    }

    /**
     * @param {string[]} remainingStepKeys
     */
    function estimateRemaining(remainingStepKeys) {
        if (!Array.isArray(remainingStepKeys) || remainingStepKeys.length === 0) {
            return {
                eta_ms: 0,
                eta_confidence: 0.95,
                model: 'history+online',
                confidence_reason: 'no-remaining-steps',
            };
        }

        let total = 0;
        let known = 0;
        for (const key of remainingStepKeys) {
            const item = history[scopedStepKey(key)];
            if (item && item.avg_ms > 0) {
                total += item.avg_ms;
                known += 1;
            }
        }

        const fallbackAvg = known > 0 ? Math.round(total / known) : 5000;
        if (known < remainingStepKeys.length) {
            total += (remainingStepKeys.length - known) * fallbackAvg;
        }

        const confidence = Math.max(0.2, Math.min(0.98, known / Math.max(1, remainingStepKeys.length)));
        return {
            eta_ms: total,
            eta_confidence: Number(confidence.toFixed(2)),
            model: 'history+online',
            confidence_reason:
                known === remainingStepKeys.length
                    ? 'all-steps-from-history'
                    : known > 0
                      ? `partial-history:${known}/${remainingStepKeys.length}`
                      : 'fallback-average-only',
        };
    }

    function persist() {
        fs.mkdirSync(path.dirname(historyPath), { recursive: true });
        fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
    }

    return {
        beginStep,
        endStep,
        estimateRemaining,
        persist,
    };
}
