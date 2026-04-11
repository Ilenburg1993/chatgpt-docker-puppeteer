// @ts-check
/**
 * src/copilot/observability/bootstrap.js
 *
 * Inicializa as dependências de observabilidade em módulos de camada inferior (`core/`).
 *
 * Esse arquivo é o único ponto de crossing intencional entre `observability/` e `core/`: ao invés de `core/` importar
 * `observability/` (inversão de camada), o bootstrap injeta as dependências via `registerErrorHandlerDeps()`.
 *
 * Deve ser chamado UMA VEZ, no bootstrap da aplicação (`src/main.js` ou equivalente), antes de qualquer uso de
 * `logSwallowed` / `wrapAsync` em runtime.
 *
 * @module copilot/observability/bootstrap
 */

import { setAuditLogger } from '../audit/logger.js';
import { registerErrorHandlerDeps } from '../core/error-handlers.js';
import { setShutdownLogger } from '../core/shutdown.js';
import { setDbLogger } from '../db/sqlite.js';
import { setCustomToolsBuilder } from '../sdk/custom-tools.js';
import { setSdkLogger } from '../sdk/logger.js';
import { defaultErrorTracker } from './error-tracker.js';
import { LOG_DIR, log } from './logger.js';

/**
 * Conecta `core/error-handlers`, `core/shutdown`, `db/sqlite`, `sdk/` e `audit/` às implementações reais de log e
 * tracking. Idempotente — pode ser chamado mais de uma vez sem efeito adverso.
 *
 * @returns {void}
 */
export function bootstrapObservability() {
    registerErrorHandlerDeps({
        log,
        tracker: defaultErrorTracker,
    });
    setShutdownLogger(log);
    setDbLogger(log);
    setSdkLogger(log);
    setAuditLogger(log, LOG_DIR);
}

/**
 * Injeta dependências tardias que requerem módulos de camadas superiores (L3+). Deve ser chamado após o bootstrap
 * básico, quando `tools/` estiver disponível.
 *
 * @param {{ buildTool?: Function }} deps
 * @returns {void}
 */
export function bootstrapLateDeps(deps) {
    if (deps.buildTool) setCustomToolsBuilder(/** @type {any} */ (deps.buildTool));
}
