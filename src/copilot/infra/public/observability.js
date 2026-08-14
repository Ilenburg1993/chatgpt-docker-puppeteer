// @ts-check
/**
 * Façade pública para APIs de observabilidade de I/O.
 *
 * Consolida snapshot de runtime (cache, parser, escopo, latência) e outras métricas
 * de observabilidade para monitoração e debugging do sistema de I/O.
 *
 * @module copilot/infra/public/observability
 */

export {
    readIoRuntimeHealthSnapshot
} from '../io-health.js';

export {
    getIoLatencyStats
} from '../io-observability.js';

export {
    getParserCacheStats,
    invalidateParserCache,
    parseAndCacheSymbols
} from '../io-parser.js';
