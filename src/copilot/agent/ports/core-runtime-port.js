// @ts-check
/**
 * @module copilot/agent/ports/core-runtime-port
 * @file Porta local do agent para primitivas do core runtime.
 *
 *   O objetivo é manter módulos operacionais do agent consumindo uma fronteira semântica local em vez de espalhar imports
 *   diretos para `#copilot/core`, `core/di-container` e `core/error-handlers`.
 */

export {
    EVENT_BUS,
    SessionError,
    getHubSessionId,
    isShuttingDown,
    setSharedSdkSessionId,
    toError,
} from '#copilot/core';
export { container } from '#copilot/core';
export { logSwallowed } from '#copilot/core';
export { setSessionModel } from '#copilot/sdk/session-runtime';
