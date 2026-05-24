// @ts-check
/**
 * Disposable model-gateway probes.
 *
 * Probes exercise the same provider/model/session contracts used by live routing, but run in temporary sessions so
 * health checks and operator diagnostics do not mutate the canonical dialog loop.
 *
 * @module copilot/model-gateway/probes
 */

export { runConfiguredByokChatProbe } from './chat-probe.js';
