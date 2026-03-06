// @ts-check
/**
 * @typedef {object} CreateProgressTrackerOptions
 * @property {number} stepsTotal
 * @property {number} startedAt
 */
/**
 * @param {CreateProgressTrackerOptions} options
  * @returns {object}
 */
export function createProgressTracker(options) {
    let stepsTotal = Math.max(1, Number(options.stepsTotal || 1));
    let stepsDone = 0;
    let currentPhase = 'preflight';
    let lastStepId = /** @type {any} */ (null);
    const startedAt = Number(options.startedAt || Date.now());

    /** @type {Map<string, number>} */
    const runningSteps = new Map();

    /** @param {any} phase */
    function setPhase(phase) {
        currentPhase = phase;
    }

    /** @param {any} nextTotal */
    function setStepsTotal(nextTotal) {
        const value = Number(nextTotal || 0);
        if (Number.isFinite(value) && value > stepsTotal) {
            stepsTotal = value;
        }
    }

    /** @param {any} stepId */
    function stepStarted(stepId) {
        lastStepId = stepId;
        runningSteps.set(stepId, Date.now());
        const minTotal = stepsDone + runningSteps.size;
        if (minTotal > stepsTotal) {
            stepsTotal = minTotal;
        }
    }

    /** @param {any} stepId */
    function stepFinished(stepId) {
        if (runningSteps.has(stepId)) {
            runningSteps.delete(stepId);
        }
        stepsDone += 1;
        if (stepsDone > stepsTotal) {
            stepsTotal = stepsDone;
        }
    }

    function snapshot(etaMs = 0) {
        const elapsedMs = Date.now() - startedAt;
        const progressPct = Math.min(100, Number(((stepsDone / Math.max(1, stepsTotal)) * 100).toFixed(2)));
        const remainingSteps = Math.max(0, stepsTotal - stepsDone);
        return {
            phase: currentPhase,
            step_id: lastStepId,
            steps_done: stepsDone,
            steps_total: stepsTotal,
            progress_pct: progressPct,
            remaining_steps: remainingSteps,
            running_steps: runningSteps.size,
            elapsed_ms: elapsedMs,
            eta_ms: Math.max(0, Number(etaMs || 0)),
        };
    }

    function complete() {
        stepsTotal = Math.max(stepsTotal, stepsDone);
        stepsDone = stepsTotal;
    }

    return {
        setPhase,
        setStepsTotal,
        stepStarted,
        stepFinished,
        snapshot,
        complete,
    };
}
