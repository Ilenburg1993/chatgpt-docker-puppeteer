// @ts-check
/**
 * Thin Agent port for best-effort reporting of intentionally swallowed failures.
 *
 * This is the only Agent logging seam that knows the concrete Observability reporter. Runtime modules import this port
 * instead of crossing directly into `observability/`.
 * @module copilot/agent/ports/logging/swallowed
 */
export { logSwallowed } from '#copilot/observability/swallowed';
