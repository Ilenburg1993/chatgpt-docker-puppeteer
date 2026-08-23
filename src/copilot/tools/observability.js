// @ts-check
/**
 * Porta pública estreita para observability injetar dependências do subsistema tools sem importar o barrel amplo.
 *
 * `#copilot/tools` continua sendo a superfície operacional completa. Esta subpath existe para evitar ciclos de boot
 * entre observability/bootstrap e tools/bootstrap.
 *
 * @module copilot/tools/observability
 */

export { setToolsLogger } from './infra/logger.js';
export { setToolsMetrics } from './infra/metrics-proxy.js';
