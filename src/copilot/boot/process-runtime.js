// @ts-check
/**
 * Exact projection of the application-owned ProcessInfra lifecycle capabilities.
 *
 * This module owns no registry, timer map, logger or shutdown state. Every operation delegates to the single ProcessInfra
 * already owned by ApplicationInfraHost. Process-boundary modules may depend on this surface; reusable domain primitives
 * should receive capabilities explicitly instead.
 * @module copilot/boot/process-runtime
 */
import { PROCESS_SHUTDOWN_PHASE } from '#copilot/infra/public/composition/process';
import { getApplicationInfraHost } from './application-infra.js';

export { PROCESS_SHUTDOWN_PHASE };

function processInfra() {
    return getApplicationInfraHost().processInfra;
}

/** @param {string} name @param {(context:{signal:AbortSignal;reason:string;name:string;phase:string})=>void|Promise<void>} handler @param {any} [phase] @param {{timeoutMs?:number}} [options] */
export function registerApplicationShutdownHandler(
    name,
    handler,
    phase = PROCESS_SHUTDOWN_PHASE.DEFAULT,
    options = {},
) {
    return processInfra().shutdown.register(name, handler, phase, options);
}
/** @param {string} [reason='unknown'] */
export function runApplicationShutdown(reason = 'unknown') {
    return processInfra().shutdown.run(reason);
}
export function isApplicationShuttingDown() {
    return processInfra().shutdown.isShuttingDown();
}
export function listApplicationShutdownHandlers() {
    return processInfra().shutdown.handlers();
}
export function getLastApplicationShutdownReport() {
    return processInfra().shutdown.lastReport();
}
export function getApplicationShutdownMetrics() {
    return processInfra().shutdown.metrics();
}
/** @param {{log?:((level:'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL',message:string)=>void)|null;emit?:((event:{type:string;timestamp:number;[key:string]:unknown})=>void)|null}} observer */
export function configureApplicationShutdownObservability(observer = {}) {
    processInfra().shutdown.configureObservability(observer);
}

/** @param {string} id @param {Parameters<typeof setInterval>[0]} callback @param {number} delay @param {...unknown} args */
export function registerApplicationInterval(id, callback, delay, ...args) {
    return processInfra().scheduler.interval(id, callback, delay, ...args);
}
/** @param {string} id @param {Parameters<typeof setTimeout>[0]} callback @param {number} delay @param {...unknown} args */
export function registerApplicationTimeout(id, callback, delay, ...args) {
    return processInfra().scheduler.timeout(id, callback, delay, ...args);
}
/** @param {string} id @param {'interval'|'timeout'} type @param {ReturnType<typeof setTimeout>} handle */
export function adoptApplicationTimer(id, type, handle) {
    return processInfra().scheduler.adopt(id, type, handle);
}
/** @param {string} id */
export function cancelApplicationTimer(id) {
    return processInfra().scheduler.cancel(id);
}
export function cancelAllApplicationTimers() {
    return processInfra().scheduler.cancelAll();
}
/** @param {number} delayMs @param {{id?:string;ref?:boolean;signal?:AbortSignal}} [options] */
export function sleepApplicationProcess(delayMs, options = {}) {
    return processInfra().scheduler.sleep(delayMs, options);
}
export function listActiveApplicationTimers() {
    return processInfra().scheduler.list();
}
export function activeApplicationTimerCount() {
    return processInfra().scheduler.activeCount();
}
