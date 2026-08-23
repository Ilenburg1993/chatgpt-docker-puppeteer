// @ts-check
/** @module copilot/infra/composition/process */
export { createProcessScheduler } from './scheduler/index.js';
export { createProcessInfra } from './service.js';
export { PROCESS_SHUTDOWN_PHASE, createProcessShutdownController } from './shutdown/index.js';
