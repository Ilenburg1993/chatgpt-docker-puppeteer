// @ts-check
/**
 * src/copilot/observability/otel.js
 *
 * Configuração de OpenTelemetry para o CopilotClient.
 *
 * O SDK Copilot suporta OTEL nativo via `CopilotClientOptions.telemetry`:
 *
 * - Emite spans automáticos para sessões, mensagens, tool calls no CLI interno
 * - Suporte a exportação OTLP HTTP ou arquivo JSONL local
 *
 * Por padrão, exporta para `src/copilot/logs/otel-traces.jsonl`. Configurável via variáveis de ambiente:
 *
 * - `COPILOT_OTEL_DISABLED` — desabilitar completamente
 * - `COPILOT_OTEL_ENDPOINT` — OTLP HTTP endpoint (ex: http://localhost:4318)
 * - `COPILOT_OTEL_EXPORTER_TYPE` — `file` (padrão) ou `otlp-http`
 * - `COPILOT_OTEL_SOURCE_NAME` — nome da instrumentação (padrão: copilot-sdk-agent)
 * - `COPILOT_OTEL_CAPTURE_CONTENT` — capturar conteúdo de mensagens (padrão: false)
 *
 * @module copilot/observability/otel
 */

import {
    COPILOT_LOG_DIR,
    COPILOT_OTEL_CAPTURE_CONTENT,
    COPILOT_OTEL_DISABLED,
    COPILOT_OTEL_ENDPOINT,
    COPILOT_OTEL_EXPORTER_TYPE,
    COPILOT_OTEL_SOURCE_NAME,
} from '#copilot/config/env';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOGS_DIR = COPILOT_LOG_DIR ? path.resolve(COPILOT_LOG_DIR) : path.resolve(__dirname, '../logs');

const DEFAULT_TRACES_FILE = path.join(LOGS_DIR, 'otel-traces.jsonl');

/**
 * @typedef {object} TelemetryConfig
 * @property {string} [otlpEndpoint] - OTLP HTTP endpoint URL.
 * @property {string} [filePath] - Caminho do arquivo JSONL para exportação.
 * @property {string} [exporterType] - `"otlp-http"` ou `"file"`.
 * @property {string} [sourceName] - Nome da instrumentação.
 * @property {boolean} [captureContent] - Capturar conteúdo de mensagens nos spans.
 */

/**
 * Constrói a configuração de telemetria para `CopilotClient`.
 *
 * Retorna `undefined` se `COPILOT_OTEL_DISABLED=true`, desabilitando o OTEL completamente.
 *
 * @example
 *     const client = new CopilotClient({ telemetry: buildTelemetryConfig() });
 *
 * @returns {TelemetryConfig | undefined}
 */
export function buildTelemetryConfig() {
    if (COPILOT_OTEL_DISABLED) {
        return undefined;
    }

    const endpoint = COPILOT_OTEL_ENDPOINT;
    const explicitExporterType = COPILOT_OTEL_EXPORTER_TYPE;
    const sourceName = COPILOT_OTEL_SOURCE_NAME;
    const captureContent = COPILOT_OTEL_CAPTURE_CONTENT;

    // Se endpoint definido → OTLP HTTP
    if (endpoint) {
        return {
            otlpEndpoint: endpoint,
            exporterType: explicitExporterType ?? 'otlp-http',
            sourceName,
            captureContent,
        };
    }

    // Padrão → exportação para arquivo local
    return {
        filePath: DEFAULT_TRACES_FILE,
        exporterType: 'file',
        sourceName,
        captureContent,
    };
}

/**
 * Verifica se OTEL está habilitado na configuração atual.
 *
 * @returns {boolean}
 */
export function isOtelEnabled() {
    return !COPILOT_OTEL_DISABLED;
}

/** Caminho padrão do arquivo de traces quando `exporterType = 'file'`. */
export const DEFAULT_OTEL_FILE = DEFAULT_TRACES_FILE;

// ─── startSpan — Instrumentação manual com OTEL (graceful degradation) ────────

/**
 * Atributos de contexto para um span OTEL.
 *
 * @typedef {object} SpanAttrs
 * @property {string} [sessionId] - ID da sessão
 * @property {string} [model] - Modelo utilizado
 * @property {string} [actor] - Ator (ex: 'llm-b', 'orchestrator')
 * @property {Record<string, unknown>} [extra] - Atributos adicionais
 */

/**
 * @typedef {object} OtelSpan
 * @property {(key: string, value: string | number | boolean) => void} setAttribute
 * @property {(status: { code: number; message?: string }) => void} setStatus
 * @property {(exception: unknown) => void} recordException
 * @property {() => void} end
 */

/**
 * @typedef {object} OtelTracer
 * @property {(name: string) => OtelSpan} startSpan
 */

/** @type {OtelTracer | null} Instância do tracer OTEL (null se não disponível) */
let _tracer = null;

/**
 * Inicializa o tracer OTEL de forma segura (graceful degradation). Tentativa única no primeiro uso. Se
 * `@opentelemetry/sdk-trace-node` não estiver instalado ou falhar, o sistema opera sem traces.
 *
 * @returns {Promise<OtelTracer | null>}
 */
async function _getTracer() {
    if (_tracer !== null) return _tracer;
    try {
        // Importação dinâmica para degradação graciosa quando o pacote não está instalado
        // @ts-expect-error — @opentelemetry/sdk-trace-node é opcional; graceful degradation se não instalado
        const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
        const { trace } = await import('@opentelemetry/api');
        const provider = new NodeTracerProvider();
        provider.register();
        _tracer = /** @type {OtelTracer} */ (/** @type {unknown} */ (trace.getTracer('copilot-agent', '1.0.0')));
        return _tracer;
    } catch {
        _tracer = null;
        return null;
    }
}

// Inicializa no carregamento do módulo para eliminar race condition
/** @type {Promise<void>} */
const _tracerInitPromise = _getTracer().then(() => undefined);

/**
 * Executa uma função dentro de um span OTEL, registrando latência e erros. Se OTEL não estiver disponível, executa a
 * função diretamente sem overhead. Propaga erros normalmente.
 *
 * @example
 *     const result = await startSpan('session.boot', { model: 'gpt-4o' }, () => boot());
 *
 * @template T
 * @param {string} name - Nome do span (ex: 'session.create', 'dialog.sendTurn')
 * @param {SpanAttrs} attrs - Atributos de contexto do span
 * @param {() => Promise<T>} fn - Função a instrumentar
 * @returns {Promise<T>}
 */
export async function startSpan(name, attrs, fn) {
    await _tracerInitPromise;

    if (!_tracer) {
        return fn();
    }

    try {
        const { context, trace } = await import('@opentelemetry/api');
        const span = _tracer.startSpan(name);
        span.setAttribute('session.id', attrs.sessionId ?? '');
        span.setAttribute('model', attrs.model ?? '');
        span.setAttribute('actor', attrs.actor ?? '');
        if (attrs.extra) {
            for (const [k, v] of Object.entries(attrs.extra)) {
                span.setAttribute(
                    k,
                    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v),
                );
            }
        }
        const ctx = trace.setSpan(context.active(), /** @type {any} */ (span));
        const start = Date.now();
        try {
            const result = await context.with(ctx, fn);
            span.setAttribute('duration_ms', Date.now() - start);
            span.setStatus({ code: /** SpanStatusCode.OK */ 1 });
            return result;
        } catch (/** @type {any} */ err) {
            span.setAttribute('duration_ms', Date.now() - start);
            span.setStatus({ code: /** SpanStatusCode.ERROR */ 2, message: err.message });
            span.recordException(err);
            throw err;
        } finally {
            span.end();
        }
    } catch {
        return fn();
    }
}

// ─── startSpanImmediate — Span sem wrapper async para event handlers ──────────

/**
 * Inicia um span OTEL sem wrapper de função (para uso em event handlers). O caller é responsável por chamar
 * `span.end()` quando a operação terminar. Se OTEL não estiver disponível, retorna `null`.
 *
 * @param {string} name - Nome do span (ex: 'copilot.tool', 'copilot.dialog.turn')
 * @param {Record<string, string | number | boolean>} [attrs] - Atributos iniciais do span
 * @returns {OtelSpan | null}
 */
export function startSpanImmediate(name, attrs = {}) {
    if (!_tracer) return null;
    try {
        const span = _tracer.startSpan(name);
        for (const [k, v] of Object.entries(attrs)) {
            span.setAttribute(k, v);
        }
        return span;
    } catch {
        return null;
    }
}
