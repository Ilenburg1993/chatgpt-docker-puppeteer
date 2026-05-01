// @ts-check
/**
 * @file Shim de compatibilidade — llm-b-frontend.
 *
 *   Todas as implementações foram migradas para `projections/`.
 *   Este arquivo existe apenas para não quebrar importadores legados.
 *   Prefira importar diretamente de `./projections/<família>.js` ou de `./index.js`.
 *
 * @deprecated Use `./index.js` ou `./projections/<família>.js` diretamente.
 */

export {
    formatTerminalRuntimeTopology,
    normalizeContextWindowProjection,
    normalizeTerminalModelBillingProjection,
    readTerminalRuntimeBase,
} from './projections/shared.js';

export { readTerminalStatusProjection } from './projections/status.js';

export {
    answerPendingTerminalQuestion,
    clearPendingTerminalQuestionShadow,
    clearTerminalHistory,
    forgetTerminalMemoryProjection,
    listTerminalSnapshotsProjection,
    loadTerminalSnapshotProjection,
    readTerminalActivityProjection,
    readTerminalContextProjection,
    readTerminalCountProjection,
    readTerminalDbHistoryProjection,
    readTerminalDbSessionsProjection,
    readTerminalDiagnoseProjection,
    readTerminalDisplayProjection,
    readTerminalHistoryProjection,
    readTerminalResumeListProjection,
    readTerminalResumeProjection,
    recallTerminalMemoriesProjection,
    rememberTerminalMemoryProjection,
    requestTerminalCompactionProjection,
    saveTerminalSnapshotProjection,
    searchTerminalTurnsProjection,
} from './projections/now.js';

export {
    listTerminalAvailableModelsProjection,
    readTerminalConfigProjection,
    readTerminalModelStatsProjection,
    setTerminalModelProjection,
    setTerminalReasoningProjection,
} from './projections/config.js';

export {
    readTerminalErrorsProjection,
    readTerminalMetricsProjection,
    readTerminalToolStatsProjection,
} from './projections/metrics.js';

export { readTerminalUsageNowProjection } from './projections/usage.js';

export {
    deleteTerminalPlanProjection,
    readTerminalPlanProjection,
    setTerminalPlanModeProjection,
    updateTerminalPlanProjection,
} from './projections/sdk-session.js';
