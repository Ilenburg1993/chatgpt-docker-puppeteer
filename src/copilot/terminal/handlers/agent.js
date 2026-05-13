// @ts-check
/**
 * @module copilot/terminal/handlers-agent
 * @file Adapter fino do terminal para a SSOT compartilhada de agent-control em `presentation/`.
 */

export {
    handleAcceptHandoff,
    handleDialogPause,
    handleDialogResume,
    handleGetContext,
    handleGetHandoffs,
    handleInject,
    handlePipeline,
    handleRejectHandoff,
} from '../../presentation/agent/index.js';
