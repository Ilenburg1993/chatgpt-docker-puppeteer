// @ts-check
/**
 * src/copilot/observability/event-bus-observers.js
 *
 * Adapter público para subscribers cross-module do EventBus.
 *
 * Este arquivo era a implementação ad hoc de subscribers no EventBus. A arquitetura atual promoveu
 * `event-bus-runtime.js` a owner canônico dessa composição.
 *
 * Deve ser chamado após `bootstrapObservability()` e após o EventBus estar registrado no container.
 *
 * Design:
 *
 * - Zero acoplamento de runtime com módulos de nível superior
 * - Todos os subscribers são registrados via `bus.on()` e podem ser removidos via `detach()`
 * - Seguro a erros: exceções nos handlers são capturadas e logadas
 *
 * @module copilot/observability/event-bus-observers
 * @see EventBus
 */

import { EVENT_BUS } from '#copilot/core';
import { container } from '../core/di-container.js';
import { METRICS_STORE } from './di-tokens.js';
import { attachObservabilityBusRuntime, detachObservabilityBusRuntime } from './event-bus-runtime.js';
import { log } from './logger.js';

/**
 * Registra subscribers do EventBus global para observabilidade cross-module.
 *
 * Idempotente — segunda chamada é no-op.
 *
 * @returns {void}
 */
export function attachEventBusObservers() {
    const bus = container.resolve(EVENT_BUS);
    const metrics = container.resolve(METRICS_STORE);
    if (!bus || !metrics) {
        log('WARN', '[event-bus-observers] EventBus ou MetricsStore indisponível — runtime não registrado');
        return;
    }
    attachObservabilityBusRuntime({ bus, metrics });
    log('INFO', '[event-bus-observers] adapter delegou para event-bus-runtime');
}

/**
 * Remove todos os subscribers registrados do EventBus.
 *
 * @returns {void}
 */
export function detachEventBusObservers() {
    detachObservabilityBusRuntime();
    log('INFO', '[event-bus-observers] adapter removeu event-bus-runtime');
}
