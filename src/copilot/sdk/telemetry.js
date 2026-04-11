// @ts-check
/**
 * src/copilot/sdk/telemetry.js
 *
 * Faixa 13 - Telemetry & Tracing facade. Builders para TelemetryConfig e re-export de getTraceContext do SDK.
 *
 * O SDK aceita `telemetry?: TelemetryConfig` em `CopilotClientOptions` para instrumentacao OTel. Tambem aceita
 * `onGetTraceContext?: TraceContextProvider` para propagacao de trace context W3C.
 *
 * @module copilot/sdk/telemetry
 * @see EventBus
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {import('@github/copilot-sdk').TelemetryConfig} TelemetryConfig
 */

/**
 * @typedef {import('@github/copilot-sdk').TraceContextProvider} TraceContextProvider
 */

/**
 * @typedef {import('@github/copilot-sdk').TraceContext} TraceContext
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Chama o TraceContextProvider fornecido e retorna o trace context W3C atual. Retorna `{}` quando nenhum provider esta
 * configurado. Compativel com a assinatura SDK `getTraceContext(provider?)`.
 *
 * @param {TraceContextProvider} [provider] - callback de trace context
 * @returns {Promise<TraceContext>}
 */
export async function getTraceContext(provider) {
    if (!provider) return {};
    return provider();
}

/**
 * Cria um TelemetryConfig para OTLP HTTP export.
 *
 * @example
 *     ```js
 *     const telemetry = createOtlpTelemetry({
 *         endpoint: 'http://localhost:4318',
 *         sourceName: 'my-copilot-app',
 *         captureContent: true,
 *     });
 *     ```;
 *
 * @param {object} options
 * @param {string} options.endpoint - OTLP HTTP endpoint URL
 * @param {string} [options.sourceName] - nome do instrumentation scope
 * @param {boolean} [options.captureContent] - se deve capturar conteudo de mensagens
 * @returns {TelemetryConfig}
 */
export function createOtlpTelemetry({ endpoint, sourceName, captureContent }) {
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
        throw new Error('[sdk/telemetry] endpoint is required and must be a non-empty string');
    }
    /** @type {TelemetryConfig} */
    const config = {
        exporterType: 'otlp-http',
        otlpEndpoint: endpoint,
    };
    if (sourceName !== undefined) config.sourceName = sourceName;
    if (captureContent !== undefined) config.captureContent = captureContent;
    return config;
}

/**
 * Cria um TelemetryConfig para file export (JSON-lines).
 *
 * @example
 *     ```js
 *     const telemetry = createFileTelemetry({
 *         filePath: '/tmp/traces.jsonl',
 *         sourceName: 'copilot-debug',
 *     });
 *     ```;
 *
 * @param {object} options
 * @param {string} options.filePath - caminho do arquivo de trace output
 * @param {string} [options.sourceName] - nome do instrumentation scope
 * @param {boolean} [options.captureContent] - se deve capturar conteudo de mensagens
 * @returns {TelemetryConfig}
 */
export function createFileTelemetry({ filePath, sourceName, captureContent }) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error('[sdk/telemetry] filePath is required and must be a non-empty string');
    }
    /** @type {TelemetryConfig} */
    const config = {
        exporterType: 'file',
        filePath,
    };
    if (sourceName !== undefined) config.sourceName = sourceName;
    if (captureContent !== undefined) config.captureContent = captureContent;
    return config;
}

/**
 * Cria um TelemetryConfig generico a partir de opcoes arbitrarias.
 *
 * @param {TelemetryConfig} options - config de telemetria
 * @returns {TelemetryConfig} config validado
 */
export function createTelemetryConfig(options) {
    if (!options || typeof options !== 'object') {
        throw new Error('[sdk/telemetry] options must be a non-null object');
    }
    if (options.exporterType !== undefined && options.exporterType !== 'otlp-http' && options.exporterType !== 'file') {
        throw new Error(
            `[sdk/telemetry] invalid exporterType: '${options.exporterType}'. Must be 'otlp-http' or 'file'`,
        );
    }
    return { ...options };
}

/**
 * Cria um TraceContextProvider simples a partir de valores estaticos. Util para testes ou quando o trace context e
 * conhecido antecipadamente.
 *
 * @example
 *     ```js
 *     const provider = createStaticTraceProvider(
 *         '00-abc123-def456-01',
 *         'vendor1=value1'
 *     );
 *     const ctx = await getTraceContext(provider);
 *     ```;
 *
 * @param {string} traceparent - W3C traceparent header
 * @param {string} [tracestate] - W3C tracestate header
 * @returns {TraceContextProvider}
 */
export function createStaticTraceProvider(traceparent, tracestate) {
    if (typeof traceparent !== 'string' || traceparent.length === 0) {
        throw new Error('[sdk/telemetry] traceparent is required and must be a non-empty string');
    }
    return () => ({
        traceparent,
        ...(tracestate !== undefined ? { tracestate } : {}),
    });
}
