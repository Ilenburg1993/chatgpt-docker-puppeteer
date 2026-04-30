// @ts-check
/**
 * src/copilot/agent/session/boot/boot-steps.js
 *
 * K5b: etapas reais do pipeline de boot extraídas de `boot-wiring.js`.
 *
 * O objetivo deste módulo é concentrar a lógica operacional das steps, deixando `boot-wiring.js` como runner e ponto de
 * composição do pipeline público.
 *
 * @module copilot/agent/session/boot-steps
 * @internal
 */

/** @typedef {import('./boot-session-prep.js').BootWiringContext} BootWiringContext */

export {
    createBootWiringState,
    stepAttachEventCollector,
    stepCleanupStaleSessions,
    stepWireSessionEvents,
} from './boot-session-prep.js';

export {
    reapExpiredPendingQuestionShadow,
    runDialogBootRecovery,
    scheduleDialogBootRecovery,
    stepScheduleDialogRecovery,
} from './boot-dialog-recovery.js';

export {
    stepAttachAgentObserver,
    stepStartKeepalive,
    stepStartMcpReconnect,
    stepStartMetricsTimer,
    stepWireHandoff,
    stepWireQuestionAnsweredRelay,
} from './boot-runtime-bind.js';
