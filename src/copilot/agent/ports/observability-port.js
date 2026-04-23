// @ts-check
/**
 * Porta de observabilidade do agent.
 *
 * Centraliza o acesso do runtime a logging, spans, métricas e snapshots para que o miolo do `agent/` não dependa
 * diretamente da topologia concreta de `observability/`.
 *
 * Esta porta é deliberadamente um re-export fino. Ela não deve reinterpretar métricas nem decidir health; serve apenas
 * como ponto de import permitido para módulos do agent que precisam registrar sinais operacionais.
 *
 * Ao adicionar nova observabilidade no runtime:
 *
 * - se for emissão/coleta transversal, exporte por aqui;
 * - se for projection para HTTP/terminal, prefira `presentation/`;
 * - se for decisão de domínio, mantenha no módulo do agent que possui o estado.
 *
 * @module copilot/agent/ports/observability-port
 * @internal
 */

export {
    ERROR_TRACKER,
    METRICS_STORE,
    buildTelemetryConfig,
    createAgentEventObserver,
    defaultErrorTracker,
    defaultEventCollector,
    defaultMetrics,
    initEventCollector,
    log,
    startSpan,
    startSpanImmediate,
} from '#copilot/observability';

export { buildStatusSnapshot } from '../../observability/snapshots.js';
