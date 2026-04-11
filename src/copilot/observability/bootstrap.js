// @ts-check
/**
 * src/copilot/observability/bootstrap.js
 *
 * Inicializa as dependências de observabilidade em módulos de camada inferior (`core/`).
 *
 * Esse arquivo é o único ponto de crossing intencional entre `observability/` e `core/`:
 * ao invés de `core/` importar `observability/` (inversão de camada), o bootstrap
 * injeta as dependências via `registerErrorHandlerDeps()`.
 *
 * Deve ser chamado UMA VEZ, no bootstrap da aplicação (`src/main.js` ou equivalente),
 * antes de qualquer uso de `logSwallowed` / `wrapAsync` em runtime.
 *
 * @module copilot/observability/bootstrap
 */

import { registerErrorHandlerDeps } from '../core/error-handlers.js';
import { defaultErrorTracker } from './error-tracker.js';
import { log } from './logger.js';

/**
 * Conecta `core/error-handlers` às implementações reais de log e tracking.
 * Idempotente — pode ser chamado mais de uma vez sem efeito adverso.
 *
 * @returns {void}
 */
export function bootstrapObservability() {
    registerErrorHandlerDeps({
        log,
        tracker: defaultErrorTracker,
    });
}
