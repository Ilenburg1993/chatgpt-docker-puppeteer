// @ts-check
/**
 * Application-owned EventBus composition.
 *
 * Events owns the implementation; boot owns the one live application instance. This module is a named owner, not a
 * generic locator: it exposes exactly one capability and no registration/resolve vocabulary.
 * @module copilot/boot/application-events
 */
import { PROCESS_SHUTDOWN_PHASE, registerApplicationShutdownHandler } from '#copilot/boot/process-runtime';
import { createEventBus } from '#copilot/events/runtime';
import { getApplicationInfraHost } from './application-infra.js';

const processInfra = getApplicationInfraHost().processInfra;
const APPLICATION_EVENT_BUS = createEventBus({ maxCounters: processInfra.config.eventBus.maxCounters });
const unregisterShutdown = registerApplicationShutdownHandler(
    'events.application.dispose',
    async () => APPLICATION_EVENT_BUS.dispose(),
    PROCESS_SHUTDOWN_PHASE.OBSERVABILITY_BUS,
);

export function getApplicationEventBus() {
    return APPLICATION_EVENT_BUS;
}
export function readApplicationEventBusSnapshot() {
    return Object.freeze({
        ownerProcessId: processInfra.processId,
        maxCounters: processInfra.config.eventBus.maxCounters,
        diagnostics: APPLICATION_EVENT_BUS.diagnostics(),
    });
}
export function disposeApplicationEvents() {
    unregisterShutdown();
    APPLICATION_EVENT_BUS.dispose();
}
