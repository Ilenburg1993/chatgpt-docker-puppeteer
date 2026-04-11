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
import { container } from '../core/di-container.js';
import { AUDIT_LOGGER, DB_LOGGER, SDK_LOGGER, SHUTDOWN_LOGGER, TOOLS_BUILDER } from '../core/di-tokens.js';
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
 * Também registra os tokens DI correspondentes no container global para consumo via DI.
 *
 * @returns {void}
 */
export function bootstrapObservability() {
    registerErrorHandlerDeps({
        log,
        tracker: defaultErrorTracker,
    });

    // Setters legados (backward compat)
    setShutdownLogger(log);
    setDbLogger(log);
    setSdkLogger(log);
    setAuditLogger(log, LOG_DIR);

    // DI container — registrar as mesmas dependências como tokens
    container.register(SHUTDOWN_LOGGER, () => log, 'singleton');
    container.register(DB_LOGGER, () => log, 'singleton');
    container.register(SDK_LOGGER, () => log, 'singleton');
    container.register(AUDIT_LOGGER, () => log, 'singleton');
}

/**
 * Injeta dependências tardias que requerem módulos de camadas superiores (L3+). Deve ser chamado após o bootstrap
 * básico, quando `tools/` estiver disponível.
 *
 * @param {{ buildTool?: Function }} deps
 * @returns {void}
 */
export function bootstrapLateDeps(deps) {
    if (deps.buildTool) {
        setCustomToolsBuilder(/** @type {any} */ (deps.buildTool));
        container.register(TOOLS_BUILDER, () => deps.buildTool, 'singleton');
    }
}
